import { TEAM, studioLocal, localInstant, addLocalDays } from "../lib/team-schedule.mjs";
import { MOODS, TEMP_CHECK_INTERVAL_MS, QUIZ_INTERVAL_MS, QUIZ_TIERS, starProgress } from "../lib/team-engagement.mjs";
import { employeeQuestionCandidates, publicQuestion } from "./creative-questions.mjs";
import { resetEngagement } from "./engagement-admin.mjs";

const moodRow = row => row ? { id: row.id, mood: row.mood, createdAt: new Date(row.created_at).toISOString() } : null;
async function preserveLegacyAttempts(db, user) {
  const users = Array.isArray(user) ? user : [user];
  if (!users.length) return;
  // Catch answers written by the old Worker during the migration/deploy window.
  await db.prepare(`INSERT OR IGNORE INTO team_quiz_attempts (user_id, day, tier, correct, points, created_at, data)
    SELECT user_id, day, 'medium', correct, points, created_at,
      json_set(data, '$.tier', 'medium', '$.question.tier', 'medium', '$.question.points', 10)
    FROM team_creative_attempts WHERE user_id IN (${users.map(() => '?').join(',')})`).bind(...users).run();
}
async function summary(db, user) {
  const [row, account] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS answered, COALESCE(SUM(correct), 0) AS correct FROM team_quiz_attempts WHERE user_id = ? AND reset_at IS NULL").bind(user).first(),
    db.prepare("SELECT * FROM team_reward_accounts WHERE user_id = ?").bind(user).first(),
  ]);
  return { ...starProgress(Number(account?.points ?? 0), Number(account?.peak_points ?? 0), Number(account?.awarded_stars ?? 0), Number(account?.removed_stars ?? 0)),
    answered: Number(row?.answered ?? 0), correct: Number(row?.correct ?? 0),
    incorrect: Number(row?.answered ?? 0) - Number(row?.correct ?? 0) };
}
async function history(db, user) {
  return (await db.prepare("SELECT data FROM team_quiz_attempts WHERE user_id = ? AND reset_at IS NULL ORDER BY day DESC, created_at DESC, tier ASC LIMIT 42").bind(user).all()).results.map(row => JSON.parse(row.data));
}
async function rewardHistory(db, user) {
  return (await db.prepare("SELECT id, kind, amount, reason, created_at FROM team_reward_changes WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 40").bind(user).all()).results
    .map(row => ({ id: row.id, kind: row.kind, amount: row.amount, reason: row.reason, createdAt: new Date(row.created_at).toISOString() }));
}
async function todayAttempts(db, user, day) {
  return (await db.prepare("SELECT data FROM team_quiz_attempts WHERE user_id = ? AND day = ? AND reset_at IS NULL ORDER BY created_at, tier").bind(user, day).all()).results.map(row => JSON.parse(row.data));
}
const pendingOfferSql = `SELECT o.* FROM team_quiz_offers o WHERE o.user_id = ? AND o.day = ?
  AND NOT EXISTS (SELECT 1 FROM team_quiz_attempts a WHERE a.user_id = o.user_id AND a.day = o.day AND a.tier = o.tier AND a.reset_at IS NULL)
  AND (o.reset_ready = 1 OR COALESCE((SELECT MAX(created_at) FROM team_quiz_attempts a
    WHERE a.user_id = o.user_id AND a.day = o.day AND a.reset_at IS NULL), 0) <= ?)
  ORDER BY o.reset_ready DESC, o.slot LIMIT 1`;
async function pendingOffer(db, user, day) {
  return db.prepare(pendingOfferSql).bind(user, day, Date.now() - QUIZ_INTERVAL_MS).first();
}
const unusedQuestion = `WITH candidate AS (
  SELECT c.value AS data FROM json_each(?) c
  WHERE NOT EXISTS (SELECT 1 FROM team_quiz_offers o WHERE o.day = ?
    AND json_extract(o.data, '$.prompt') = json_extract(c.value, '$.prompt'))
  AND NOT EXISTS (SELECT 1 FROM team_quiz_attempts a WHERE a.day = ?
    AND json_extract(a.data, '$.question.prompt') = json_extract(c.value, '$.prompt'))
  ORDER BY CAST(c.key AS INTEGER) LIMIT 1
)`;
async function offerQuestion(db, user, day, now) {
  const pending = await pendingOffer(db, user, day);
  if (pending) {
    // Only replace an unanswered pre-update offer when its prompt was also issued
    // to someone else. Unique snapshots and all submitted answers stay untouched.
    const pendingId = JSON.parse(pending.data).id;
    if (pendingId.startsWith("v3:") && !pendingId.includes(":reset:")) {
      await db.prepare(`${unusedQuestion}
        UPDATE team_quiz_offers AS o SET data = (SELECT data FROM candidate), dismissed_at = NULL
        WHERE o.user_id = ? AND o.day = ? AND o.slot = ? AND o.data = ?
          AND EXISTS (SELECT 1 FROM candidate)
          AND NOT EXISTS (SELECT 1 FROM team_quiz_attempts a WHERE a.user_id = o.user_id AND a.day = o.day AND a.tier = o.tier AND a.reset_at IS NULL)
          AND (EXISTS (SELECT 1 FROM team_quiz_offers other WHERE other.day = o.day AND other.user_id != o.user_id
            AND json_extract(other.data, '$.prompt') = json_extract(o.data, '$.prompt'))
            OR EXISTS (SELECT 1 FROM team_quiz_attempts a WHERE a.day = o.day AND a.user_id != o.user_id
              AND json_extract(a.data, '$.question.prompt') = json_extract(o.data, '$.prompt')))`)
        .bind(JSON.stringify(employeeQuestionCandidates(day, pending.tier, user)), day, day,
          user, day, pending.slot, pending.data).run();
      return pendingOffer(db, user, day);
    }
    return pending;
  }
  const attempts = await todayAttempts(db, user, day);
  if (attempts.length >= 3 || (attempts.length && Date.parse(attempts.at(-1).createdAt) + QUIZ_INTERVAL_MS > now)) return null;
  const remaining = QUIZ_TIERS.filter(tier => !attempts.some(a => a.tier === tier.id));
  const tier = remaining[crypto.getRandomValues(new Uint32Array(1))[0] % remaining.length].id;
  // Competing devices can propose different tiers, but only one slot wins.
  // Re-check eligibility in the INSERT so a stale request cannot skip the wait.
  await db.prepare(`${unusedQuestion}
    INSERT OR IGNORE INTO team_quiz_offers (user_id, day, slot, tier, offered_at, data)
    SELECT ?, ?, ?, ?, ?, candidate.data FROM candidate WHERE
      (SELECT COUNT(*) FROM team_quiz_attempts WHERE user_id = ? AND day = ? AND reset_at IS NULL) = ?
      AND COALESCE((SELECT MAX(created_at) FROM team_quiz_attempts WHERE user_id = ? AND day = ? AND reset_at IS NULL), 0) <= ?
      AND NOT EXISTS (SELECT 1 FROM team_quiz_offers o WHERE o.user_id = ? AND o.day = ?
        AND NOT EXISTS (SELECT 1 FROM team_quiz_attempts a WHERE a.user_id = o.user_id AND a.day = o.day AND a.tier = o.tier AND a.reset_at IS NULL))`)
    .bind(JSON.stringify(employeeQuestionCandidates(day, tier, user)), day, day, user, day, attempts.length + 1, tier, now,
      user, day, attempts.length, user, day, now - QUIZ_INTERVAL_MS, user, day).run();
  return pendingOffer(db, user, day);
}
async function employeeState(db, user, now) {
  const day = studioLocal(now).slice(0, 10);
  await offerQuestion(db, user, day, now);
  const [state, attempts, offer, latest, stats, recent, rewards] = await Promise.all([
    db.prepare("SELECT * FROM team_engagement_state WHERE user_id = ?").bind(user).first(),
    todayAttempts(db, user, day), pendingOffer(db, user, day),
    db.prepare("SELECT id, mood, created_at FROM team_mood_checkins WHERE user_id = ? AND reset_at IS NULL ORDER BY created_at DESC LIMIT 1").bind(user).first(),
    summary(db, user), history(db, user), rewardHistory(db, user),
  ]);
  const available = Boolean(offer && !attempts.some(a => a.tier === offer.tier)), question = available ? publicQuestion(JSON.parse(offer.data)) : null;
  const quiz = attempts.map(attempt => ({ question: attempt.question, attempt }));
  if (question) quiz.push({ question, attempt: null });
  return { quizVersion: 3, serverNow: now, day, moodDue: (state?.next_mood_at ?? 0) <= now,
    nextMoodAt: state?.next_mood_at ?? 0, moodRevision: state?.mood_revision ?? 0, lastMood: moodRow(latest),
    questionDue: available && offer.dismissed_at === null, available,
    currentQuestionId: question?.id ?? attempts.at(-1)?.question.id ?? null,
    answeredToday: attempts.length,
    nextQuestionAt: !available && attempts.length > 0 && attempts.length < 3 ? Math.min(Date.parse(attempts.at(-1).createdAt) + QUIZ_INTERVAL_MS, Date.parse(localInstant(addLocalDays(`${day}T00:00`, 1)))) : null,
    quiz, summary: stats, history: recent, rewards };
}
async function teamState(db, env, now) {
  const day = studioLocal(now).slice(0, 10), active = JSON.parse(env.TEAM_TOKEN_HASHES);
  const people = TEAM.filter(p => p.id !== "owner" && active[p.id]);
  await preserveLegacyAttempts(db, people.map(p => p.id));
  const [offers, states, resets] = await Promise.all([
    db.prepare("SELECT user_id, tier, data FROM team_quiz_offers WHERE day = ? ORDER BY slot").bind(day).all(),
    db.prepare("SELECT user_id, mood_revision FROM team_engagement_state").all(),
    db.prepare(`SELECT * FROM (SELECT id, user_id, kind, tier, reason, points_removed, created_at,
      ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS rank FROM team_engagement_resets) WHERE rank <= 20`).all(),
  ]);
  const members = await Promise.all(people.map(async person => {
    const [stats, recent, rewards, moods] = await Promise.all([summary(db, person.id), history(db, person.id), rewardHistory(db, person.id),
      db.prepare("SELECT id, mood, created_at FROM team_mood_checkins WHERE user_id = ? AND reset_at IS NULL ORDER BY created_at DESC LIMIT 10").bind(person.id).all()]);
    return { userId: person.id, name: person.name, color: person.color, summary: stats, history: recent, rewards,
      moods: moods.results.map(moodRow), today: recent.filter(item => item.day === day),
      moodRevision: states.results.find(row => row.user_id === person.id)?.mood_revision ?? 0,
      todayQuiz: [
        ...offers.results.filter(row => row.user_id === person.id).map(row => ({ question: publicQuestion(JSON.parse(row.data)),
          attempt: recent.find(item => item.day === day && item.tier === row.tier) ?? null })),
        ...recent.filter(item => item.day === day && !offers.results.some(row => row.user_id === person.id && row.tier === item.tier))
          .map(attempt => ({ question: attempt.question, attempt })),
      ],
      resets: resets.results.filter(row => row.user_id === person.id).map(row => ({ id: row.id, kind: row.kind, tier: row.tier, reason: row.reason,
        pointsRemoved: row.points_removed, createdAt: new Date(row.created_at).toISOString() })) };
  }));
  return { quizVersion: 3, ownerControlsVersion: 1, serverNow: now, day, members };
}

export async function engagementRoute({ request, db, user, env, body, fail }) {
  const path = new URL(request.url).pathname, now = Date.now(), day = studioLocal(now).slice(0, 10);
  if (request.method === "GET" && path === "/engagement/team") {
    if (user !== "owner") fail(403, "Only Smooth can review team check-ins and results.");
    return teamState(db, env, now);
  }
  if (request.method === "POST" && path === "/engagement/reset") {
    if (user !== "owner") fail(403, "Only Smooth can reset check-ins and quiz questions.");
    await resetEngagement({ db, input: await body(request), env, day, now, fail });
    return teamState(db, env, now);
  }
  if (request.method === "POST" && path === "/engagement/rewards") {
    if (user !== "owner") fail(403, "Only Smooth can adjust points or award SmoothStars.");
    const input = await body(request), active = JSON.parse(env.TEAM_TOKEN_HASHES);
    if (!TEAM.some(p => p.id !== "owner" && p.id === input.userId && active[p.id])) fail(400, "Choose an active employee.");
    if (typeof input.requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(input.requestId)) fail(400, "Refresh this adjustment and try again.");
    if (!["points", "star"].includes(input.kind) || !Number.isSafeInteger(input.amount) ||
      (input.kind === "points" ? input.amount === 0 || Math.abs(input.amount) > 10000 : input.amount !== 1 && !(input.amount < 0 && input.amount >= -10000))) fail(400, "Enter a whole-number points adjustment, award one SmoothStar, or choose how many to remove.");
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (!reason || reason.length > 240) fail(400, "Add a short reason (up to 240 characters).");
    const id = `owner:${input.requestId}`;
    const previous = await db.prepare("SELECT * FROM team_reward_changes WHERE id = ?").bind(id).first();
    if (previous && (previous.user_id !== input.userId || previous.kind !== input.kind || previous.amount !== input.amount || previous.reason !== reason)) fail(409, "This request was already used for a different adjustment. Refresh before making another.");
    if (!previous) {
      await preserveLegacyAttempts(db, input.userId);
      // The balance condition and trigger run atomically, including across owner tabs.
      await db.prepare(`INSERT OR IGNORE INTO team_reward_changes (id, user_id, kind, amount, reason, actor, created_at)
        SELECT ?, ?, ?, ?, ?, 'owner', ? WHERE CASE WHEN ? = 'star' THEN
          COALESCE((SELECT CAST(peak_points / 100 AS INTEGER) + awarded_stars - removed_stars FROM team_reward_accounts WHERE user_id = ?), 0) + ? >= 0
        ELSE COALESCE((SELECT points FROM team_reward_accounts WHERE user_id = ?), 0) + ? >= 0 END`)
        .bind(id, input.userId, input.kind, input.amount, reason, now, input.kind, input.userId, input.amount, input.userId, input.amount).run();
      const saved = await db.prepare("SELECT * FROM team_reward_changes WHERE id = ?").bind(id).first();
      if (!saved) fail(409, `That would take their ${input.kind === "star" ? "SmoothStars" : "points"} below zero. Refresh and choose a smaller amount.`);
      if (saved.user_id !== input.userId || saved.kind !== input.kind || saved.amount !== input.amount || saved.reason !== reason) fail(409, "This request was already used for a different adjustment. Refresh before making another.");
    }
    return teamState(db, env, now);
  }
  if (user === "owner") fail(403, "Temp Check and daily questions are for employee accounts. Review them in Team.");
  await preserveLegacyAttempts(db, user);
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
      db.prepare("UPDATE team_engagement_state SET next_mood_at = ?, last_mood_id = ?, mood_revision = mood_revision + 1 WHERE user_id = ? AND next_mood_at <= ?")
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
      await db.prepare("UPDATE team_engagement_state SET next_mood_at = ?, mood_revision = mood_revision + 1 WHERE user_id = ? AND next_mood_at <= ?")
        .bind(now + TEMP_CHECK_INTERVAL_MS, user, now).run();
    } else {
      if (input.day !== day) fail(409, "A new studio day has started. Refresh for today's question.");
      const offer = await pendingOffer(db, user, day);
      if (!offer || JSON.parse(offer.data).id !== input.questionId) fail(409, "Refresh to see your current question.");
      await db.prepare("UPDATE team_quiz_offers SET dismissed_at = COALESCE(dismissed_at, ?) WHERE user_id = ? AND day = ? AND slot = ?").bind(now, user, day, offer.slot).run();
    }
    return employeeState(db, user, now);
  }
  if (request.method === "POST" && path === "/engagement/answer") {
    const input = await body(request);
    if (input.day !== day) fail(409, "A new studio day has started. Refresh for today's question.");
    if (!QUIZ_TIERS.some(tier => tier.id === input.tier)) fail(409, "Daily Quiz has been updated. Reload to see your current question.");
    // Retry safely after a lost response, including after question-bank changes.
    const existing = await db.prepare("SELECT data FROM team_quiz_attempts WHERE user_id = ? AND day = ? AND tier = ? AND reset_at IS NULL").bind(user, day, input.tier).first();
    if (existing) {
      if (JSON.parse(existing.data).question.id !== input.questionId) fail(409, "This question was reset. Refresh before answering.");
      return employeeState(db, user, now);
    }
    const offer = await pendingOffer(db, user, day);
    if (!offer || offer.tier !== input.tier) fail(409, "That question is not available yet. Refresh to see your next quiz time.");
    const question = JSON.parse(offer.data);
    if (input.questionId !== question.id) fail(409, "This question has changed. Refresh before answering.");
    if (!question.options.some(option => option.id === input.optionId)) fail(400, "Select an answer before submitting.");
    const correct = input.optionId === question.correctOptionId;
    const attempt = { day, tier: question.tier, createdAt: new Date(now).toISOString(), question: publicQuestion(question),
      selectedOptionId: input.optionId, correctOptionId: question.correctOptionId, correct,
      points: correct ? question.points : 0, explanation: question.explanation, source: question.source };
    // Unique user/day/tier and a conditional upsert score each active attempt once.
    // Replacing a reset attempt requires the currently eligible question ID.
    await db.prepare(`INSERT INTO team_quiz_attempts (user_id, day, tier, correct, points, created_at, data)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE json_extract((SELECT data FROM (${pendingOfferSql})), '$.id') = ?
      ON CONFLICT(user_id, day, tier) DO UPDATE SET correct = excluded.correct, points = excluded.points,
        created_at = excluded.created_at, data = excluded.data, reset_at = NULL WHERE team_quiz_attempts.reset_at IS NOT NULL`)
      .bind(user, day, question.tier, correct ? 1 : 0, attempt.points, now, JSON.stringify(attempt), user, day, now - QUIZ_INTERVAL_MS, input.questionId).run();
    const saved = await db.prepare("SELECT data FROM team_quiz_attempts WHERE user_id = ? AND day = ? AND tier = ? AND reset_at IS NULL").bind(user, day, input.tier).first();
    if (!saved || JSON.parse(saved.data).question.id !== input.questionId) fail(409, "This question changed. Refresh before answering.");
    return employeeState(db, user, now);
  }
  fail(404, "Check-in endpoint not found.");
}
