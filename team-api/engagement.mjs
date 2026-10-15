import { TEAM, studioLocal } from "../lib/team-schedule.mjs";
import { MOODS, TEMP_CHECK_INTERVAL_MS, CORRECT_ANSWER_POINTS, starProgress } from "../lib/team-engagement.mjs";
import { dailyQuestion, publicQuestion } from "./creative-questions.mjs";

const moodRow = row => row ? { id: row.id, mood: row.mood, createdAt: new Date(row.created_at).toISOString() } : null;
async function summary(db, user) {
  const row = await db.prepare("SELECT COUNT(*) AS answered, COALESCE(SUM(correct), 0) AS correct, COALESCE(SUM(points), 0) AS points FROM team_creative_attempts WHERE user_id = ?").bind(user).first();
  return { ...starProgress(Number(row?.points ?? 0)), answered: Number(row?.answered ?? 0),
    correct: Number(row?.correct ?? 0), incorrect: Number(row?.answered ?? 0) - Number(row?.correct ?? 0) };
}
async function history(db, user) {
  return (await db.prepare("SELECT data FROM team_creative_attempts WHERE user_id = ? ORDER BY day DESC LIMIT 14").bind(user).all()).results.map(row => JSON.parse(row.data));
}
async function employeeState(db, user, now) {
  const day = studioLocal(now).slice(0, 10);
  const [state, attemptRow, latest, stats, recent] = await Promise.all([
    db.prepare("SELECT * FROM team_engagement_state WHERE user_id = ?").bind(user).first(),
    db.prepare("SELECT data FROM team_creative_attempts WHERE user_id = ? AND day = ?").bind(user, day).first(),
    db.prepare("SELECT id, mood, created_at FROM team_mood_checkins WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").bind(user).first(),
    summary(db, user), history(db, user),
  ]);
  const attempt = attemptRow ? JSON.parse(attemptRow.data) : null;
  return { serverNow: now, day, moodDue: (state?.next_mood_at ?? 0) <= now,
    nextMoodAt: state?.next_mood_at ?? 0, lastMood: moodRow(latest),
    questionDue: !attempt && state?.question_dismissed_day !== day,
    question: attempt?.question ?? publicQuestion(dailyQuestion(day)), attempt, summary: stats, history: recent };
}

export async function engagementRoute({ request, db, user, env, body, fail }) {
  const path = new URL(request.url).pathname, now = Date.now(), day = studioLocal(now).slice(0, 10);
  if (request.method === "GET" && path === "/engagement/team") {
    if (user !== "owner") fail(403, "Only Smooth can review team check-ins and results.");
    const active = JSON.parse(env.TEAM_TOKEN_HASHES);
    const members = await Promise.all(TEAM.filter(p => p.id !== "owner" && active[p.id]).map(async person => {
      const [stats, recent, moods] = await Promise.all([summary(db, person.id), history(db, person.id),
        db.prepare("SELECT id, mood, created_at FROM team_mood_checkins WHERE user_id = ? ORDER BY created_at DESC LIMIT 10").bind(person.id).all()]);
      return { userId: person.id, name: person.name, color: person.color, summary: stats, history: recent,
        moods: moods.results.map(moodRow), today: recent.find(item => item.day === day) ?? null };
    }));
    return { serverNow: now, day, members };
  }
  if (user === "owner") fail(403, "Temp Check and daily questions are for employee accounts. Review them in Team.");
  if (request.method === "GET" && path === "/engagement") return employeeState(db, user, now);
  if (request.method === "POST" && path === "/engagement/mood") {
    const input = await body(request);
    if (!MOODS.some(m => m.id === input.mood)) fail(400, "Choose one of the mood icons.");
    if (typeof input.requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(input.requestId)) fail(400, "Refresh this check-in and try again.");
    const id = `${user}:${input.requestId}`;
    const duplicate = await db.prepare("SELECT id FROM team_mood_checkins WHERE id = ? AND user_id = ?").bind(id, user).first();
    if (duplicate) return employeeState(db, user, now);
    await db.prepare("INSERT OR IGNORE INTO team_engagement_state (user_id) VALUES (?)").bind(user).run();
    // The conditional update and insert share one transaction. Two devices can
    // never log two moods or restart the timer for the same three-hour period.
    const result = await db.batch([
      db.prepare("UPDATE team_engagement_state SET next_mood_at = ?, last_mood_id = ? WHERE user_id = ? AND next_mood_at <= ?")
        .bind(now + TEMP_CHECK_INTERVAL_MS, id, user, now),
      db.prepare(`INSERT OR IGNORE INTO team_mood_checkins (id, user_id, mood, created_at)
        SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM team_engagement_state WHERE user_id = ? AND last_mood_id = ? AND next_mood_at = ?)`)
        .bind(id, user, input.mood, now, user, id, now + TEMP_CHECK_INTERVAL_MS),
    ]);
    if (!result[0].meta.changes) {
      const saved = await db.prepare("SELECT id FROM team_mood_checkins WHERE id = ? AND user_id = ?").bind(id, user).first();
      if (!saved) fail(409, "This Temp Check was already handled. Refresh to see your next check-in time.");
    }
    return employeeState(db, user, now);
  }
  if (request.method === "POST" && path === "/engagement/dismiss") {
    const input = await body(request);
    if (!["mood", "question"].includes(input.kind)) fail(400, "Choose the prompt to dismiss.");
    await db.prepare("INSERT OR IGNORE INTO team_engagement_state (user_id) VALUES (?)").bind(user).run();
    if (input.kind === "mood") {
      await db.prepare("UPDATE team_engagement_state SET next_mood_at = ? WHERE user_id = ? AND next_mood_at <= ?")
        .bind(now + TEMP_CHECK_INTERVAL_MS, user, now).run();
    } else {
      if (input.day !== day) fail(409, "A new studio day has started. Refresh for today's question.");
      await db.prepare("UPDATE team_engagement_state SET question_dismissed_day = ? WHERE user_id = ?").bind(day, user).run();
    }
    return employeeState(db, user, now);
  }
  if (request.method === "POST" && path === "/engagement/answer") {
    const input = await body(request);
    if (input.day !== day) fail(409, "A new studio day has started. Refresh for today's question.");
    // Retry safely after a lost response, including after question-bank changes.
    const existing = await db.prepare("SELECT data FROM team_creative_attempts WHERE user_id = ? AND day = ?").bind(user, day).first();
    if (existing) return employeeState(db, user, now);
    const question = dailyQuestion(day);
    if (input.questionId !== question.id) fail(409, "This question has changed. Refresh before answering.");
    if (!question.options.some(option => option.id === input.optionId)) fail(400, "Select an answer before submitting.");
    const correct = input.optionId === question.correctOptionId;
    const attempt = { day, createdAt: new Date(now).toISOString(), question: publicQuestion(question),
      selectedOptionId: input.optionId, correctOptionId: question.correctOptionId, correct,
      points: correct ? CORRECT_ANSWER_POINTS : 0, explanation: question.explanation, source: question.source };
    // Unique user/day + INSERT OR IGNORE makes retries and simultaneous devices
    // award points at most once, even when they submit different answers.
    await db.prepare("INSERT OR IGNORE INTO team_creative_attempts (user_id, day, correct, points, created_at, data) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(user, day, correct ? 1 : 0, attempt.points, now, JSON.stringify(attempt)).run();
    return employeeState(db, user, now);
  }
  fail(404, "Check-in endpoint not found.");
}
