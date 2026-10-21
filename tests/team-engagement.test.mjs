import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test, { mock } from "node:test";
import worker from "../team-api/worker.mjs";
import { TEAM } from "../lib/team-schedule.mjs";
import { teamToken, tokenHash } from "../lib/team-auth.mjs";
import { TEMP_CHECK_MIN_MS, TEMP_CHECK_MAX_MS, QUIZ_INTERVAL_MS, MOODS, QUIZ_TIERS, nextEngagementPrompt, starProgress } from "../lib/team-engagement.mjs";
import { dailyQuestion, employeeQuestionCandidates, publicQuestion, QUESTION_BANK, QUESTION_BANKS } from "../team-api/creative-questions.mjs";

const migrations = await Promise.all(["0000_brief_ravenous.sql", "0001_initial_state.sql", "0002_guideline_questions.sql", "0003_work_preferences.sql", "0004_team_engagement.sql", "0005_daily_quiz_tiers.sql", "0006_paced_quizzes_rewards.sql", "0007_individual_quiz_lookup.sql", "0008_engagement_owner_controls.sql", "0009_push_notifications.sql", "0027_temp_check_pacing.sql", "0016_smoothstar_500_points.sql"].map(name => readFile(new URL(`../team-api/migrations/${name}`, import.meta.url), "utf8")));
const tokens = Object.fromEntries(await Promise.all([...TEAM.map(p => p.id), "sync"].map(async id => [id, await teamToken(`synthetic-engagement-test-only-${id}`, id)])));
const hashes = Object.fromEntries(await Promise.all(Object.entries(tokens).map(async ([id, token]) => [id, await tokenHash(token)])));
const now = Date.parse("2026-10-15T17:00:00Z"), today = "2026-10-15";
mock.timers.enable({ apis: ["Date"], now });
test.beforeEach(() => mock.timers.setTime(now));
test.after(() => mock.timers.reset());

class D1 {
  constructor(beforeStarMigration) { this.sqlite = new DatabaseSync(":memory:"); this.queries = 0; this.errors = []; migrations.forEach((sql, index) => { if (index === migrations.length - 1) beforeStarMigration?.(this.sqlite); this.sqlite.exec(sql); }); }
  prepare(sql) {
    const db = this.sqlite, owner = this; let args = [];
    return { bind(...values) { args = values; return this; },
      async first() { owner.queries++; return db.prepare(sql).get(...args) ?? null; },
      async all() { owner.queries++; return { results: db.prepare(sql).all(...args) }; },
      runSync() { owner.queries++; try { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; } catch(error) { owner.errors.push(error.message); throw error; } },
      async run() { return this.runSync(); } };
  }
  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try { const results = statements.map(s => s.runSync()); this.sqlite.exec("COMMIT"); return results; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}
function fixture(beforeStarMigration) {
  const DB = new D1(beforeStarMigration), env = { DB, TEAM_TOKEN_HASHES: JSON.stringify(hashes) }, alerts = [];
  const call = async (user, path = "/engagement", data, method = data ? "POST" : "GET") => {
    const response = await worker.fetch(new Request(`https://api.example.invalid${path}`, {
      method, headers: { "content-type": "application/json", origin: "https://dashboard.smoothstudios.co", ...(user ? { authorization: `Bearer ${tokens[user] ?? user}` } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}),
    }), env, { waitUntil: promise => alerts.push(promise) });
    return { status: response.status, data: await response.json() };
  };
  return { DB, env, call, alerts };
}
function answer(day = today, correct = true, tier = "medium") {
  const q = dailyQuestion(day, tier);
  return { day, tier, questionId: q.id, optionId: correct ? q.correctOptionId : q.options.find(o => o.id !== q.correctOptionId).id };
}
const mood = (value = "happy", requestId = crypto.randomUUID()) => ({ mood: value, requestId });

const current = state => state.quiz.find(item => item.question.id === state.currentQuestionId);
async function offered(f, user, correct = true) {
  const state = (await f.call(user)).data;
  assert.equal(state.available, true);
  const tier = current(state).question.tier;
  const q = JSON.parse(f.DB.sqlite.prepare("SELECT data FROM team_quiz_offers WHERE user_id = ? AND day = ? AND tier = ?").get(user, state.day, tier).data);
  return { day: state.day, tier, questionId: q.id, optionId: correct ? q.correctOptionId : q.options.find(o => o.id !== q.correctOptionId).id };
}
const adjustment = (amount = 10, extra = {}) => ({ requestId: crypto.randomUUID(), userId: "jordyn", kind: "points", amount, ...extra });
const reportMember = (data, id = "jordyn") => data.members.find(p => p.userId === id);

test("team history keeps per-person limits and order within the larger roster query budget", async () => {
  const f = fixture();
  for (const user of ["carlos", "armani"]) {
    for (let i = 0; i < 45; i++) f.DB.sqlite.prepare("INSERT INTO team_reward_changes (id, user_id, kind, amount, reason, actor, created_at) VALUES (?, ?, 'points', 1, 'Fixture', 'owner', ?)").run(`${user}-reward-${i}`, user, now + i);
    for (let i = 0; i < 12; i++) f.DB.sqlite.prepare("INSERT INTO team_mood_checkins (id, user_id, mood, created_at, reset_at) VALUES (?, ?, 'happy', ?, ?)").run(`${user}-mood-${i}`, user, now + i, i === 11 ? now + 12 : null);
  }
  f.DB.queries = 0;
  const result = await f.call("owner", "/engagement/team");
  assert.equal(result.status, 200);
  assert.ok(f.DB.queries <= 50);
  for (const user of ["carlos", "armani"]) {
    const person = reportMember(result.data, user);
    assert.deepEqual(person.rewards.map(r => r.id), Array.from({ length: 40 }, (_, i) => `${user}-reward-${44 - i}`));
    assert.deepEqual(person.moods.map(m => m.id), Array.from({ length: 10 }, (_, i) => `${user}-mood-${10 - i}`));
  }
  assert.deepEqual(reportMember(result.data).rewards, []);
});

async function resetInput(f, kind = "question", user = "jordyn", tier) {
  const report = (await f.call("owner", "/engagement/team")).data, member = reportMember(report, user);
  const question = tier ? member.todayQuiz.find(item => item.question.tier === tier) : member.todayQuiz.at(-1);
  return { requestId: crypto.randomUUID(), userId: user, day: report.day, kind,
    ...(kind === "mood" ? { moodRevision: member.moodRevision } : { tier: question.question.tier, questionId: question.question.id, attemptedAt: question.attempt?.createdAt ?? null }) };
}

test("private employee state exposes only one server-issued question and no unanswered key", async () => {
  const f = fixture();
  for (const [user, path, status] of [[null, "/engagement", 401], ["sync", "/engagement", 403], ["owner", "/engagement", 403], ["jordyn", "/engagement/team", 403]]) assert.equal((await f.call(user, path)).status, status);
  assert.equal((await f.call("owner", "/engagement/mood", mood())).status, 403);
  const state = (await f.call("jordyn")).data;
  assert.equal(state.quizVersion, 3);
  assert.equal(state.day, today);
  assert.equal(state.moodDue, true);
  assert.equal(state.questionDue, true);
  assert.equal(state.quiz.length, 1);
  assert.equal(state.summary.points, 0);
  const q = current(state).question;
  assert.equal(q.options.length, 4);
  for (const key of ["correctOptionId", "explanation", "source"]) assert.ok(!(key in q));
  assert.equal((await f.call("owner", "/health")).data.engagementVersion, 5);
});

test("moods remain private and independent of quiz points, assignments, and notifications", async () => {
  const f = fixture();
  const response = await f.call("jordyn", "/engagement/mood", { ...mood("chilling"), userId: "rayne", createdAt: "2099-01-01", points: 10000 });
  assert.equal(response.status, 200);
  const mine = (await f.call("jordyn", "/engagement?user=rayne")).data;
  assert.equal(mine.lastMood.mood, "chilling");
  assert.equal(mine.lastMood.createdAt, new Date(now).toISOString());
  assert.equal(mine.summary.points, 0);
  assert.equal((await f.call("rayne")).data.lastMood, null);
  const report = (await f.call("owner", "/engagement/team")).data;
  assert.equal(reportMember(report).moods[0].mood, "chilling");
  assert.equal(reportMember(report, "rayne").moods.length, 0);
  assert.equal(f.DB.sqlite.prepare("SELECT revision FROM team_state").get().revision, 0);
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM team_assignments").get().n, 0);
  assert.equal(f.alerts.length, 0);
});

test("Temp Check keeps a varied server cooldown and idempotent concurrent retries", async () => {
  const f = fixture(), input = mood();
  const requests = await Promise.all(Array.from({ length: 6 }, () => f.call("amia", "/engagement/mood", input)));
  assert.ok(requests.every(r => r.status === 200));
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM team_mood_checkins").get().n, 1);
  const nextMoodAt = requests[0].data.nextMoodAt;
  assert.ok(nextMoodAt >= now + TEMP_CHECK_MIN_MS && nextMoodAt <= now + TEMP_CHECK_MAX_MS);
  mock.timers.setTime(now + 60000);
  assert.equal((await f.call("amia", "/engagement/mood", input)).data.nextMoodAt, nextMoodAt);
  assert.equal((await f.call("amia", "/engagement/mood", mood("sad"))).status, 409);
  mock.timers.setTime(nextMoodAt - 1);
  assert.equal((await f.call("amia")).data.moodDue, false);
  mock.timers.setTime(nextMoodAt);
  assert.equal((await f.call("amia", "/engagement/mood", mood("tired"))).status, 200);
  const g = fixture();
  const competing = await Promise.all([g.call("rayne", "/engagement/mood", mood("happy")), g.call("rayne", "/engagement/mood", mood("sad"))]);
  assert.deepEqual(competing.map(r => r.status).sort(), [200, 409]);
});

test("skip is persistent and optional, while question dismissal applies only to the offered question", async () => {
  const f = fixture();
  const first = (await f.call("rayne", "/engagement/dismiss", { kind: "mood" })).data;
  mock.timers.setTime(now + 5000);
  assert.equal((await f.call("rayne", "/engagement/dismiss", { kind: "mood" })).data.nextMoodAt, first.nextMoodAt);
  const input = await offered(f, "rayne");
  await f.call("rayne", "/engagement/dismiss", { kind: "question", day: today, questionId: input.questionId });
  assert.equal((await f.call("rayne")).data.questionDue, false);
  assert.equal((await f.call("rayne")).data.available, true);
  assert.equal((await f.call("rayne", "/engagement/answer", input)).status, 200);
  mock.timers.setTime(now + 5000 + QUIZ_INTERVAL_MS);
  const next = (await f.call("rayne")).data;
  assert.equal(next.questionDue, true);
  assert.notEqual(next.currentQuestionId, input.questionId);
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM team_mood_checkins").get().n, 0);
});

test("sporadic Temp Check prompts claim once across repeat visits and devices while staying answerable", async () => {
  const f = fixture();
  const responses = await Promise.all(Array.from({length: 5}, () => f.call('jordyn', '/engagement/mood-prompt', {})));
  assert.equal(responses.filter(r => r.data.promptClaimed).length, 1);
  const state = (await f.call('jordyn')).data, next = state.nextMoodPromptAt;
  assert.equal(state.moodDue, true); assert.equal(state.moodPromptDue, false);
  assert.ok(next >= now + TEMP_CHECK_MIN_MS && next <= now + TEMP_CHECK_MAX_MS);
  assert.notEqual(nextEngagementPrompt(state), 'mood');
  mock.timers.setTime(now + 30 * 60_000);
  assert.equal((await f.call('jordyn', '/engagement/mood-prompt', {})).data.promptClaimed, false);
  assert.equal((await f.call('jordyn')).data.nextMoodPromptAt, next);
  mock.timers.setTime(next);
  assert.equal((await f.call('jordyn', '/engagement/mood-prompt', {})).data.promptClaimed, true);
  assert.equal((await f.call('jordyn', '/engagement/mood', mood())).status, 200);
  assert.equal((await f.call('jordyn', '/engagement/mood-prompt', {})).data.promptClaimed, false);
  const reset = await resetInput(f, 'mood');
  assert.equal((await f.call('owner', '/engagement/reset', reset)).status, 200);
  assert.equal((await f.call('jordyn', '/engagement/mood-prompt', {})).data.promptClaimed, true);
  assert.equal((await f.call('owner', '/engagement/mood-prompt', {})).status, 403);
});

test("random difficulty is persisted across refreshes and simultaneous devices", async () => {
  const f = fixture();
  const responses = await Promise.all(Array.from({ length: 12 }, () => f.call("jordyn")));
  assert.ok(responses.every(r => r.status === 200 && r.data.quiz.length === 1));
  assert.equal(new Set(responses.map(r => r.data.currentQuestionId)).size, 1);
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM team_quiz_offers").get().n, 1);
  const initial = current(responses[0].data).question;
  mock.timers.setTime(now + 4 * QUIZ_INTERVAL_MS);
  assert.deepEqual(current((await f.call("jordyn")).data).question, initial);
  assert.equal((await f.call("jordyn")).data.answeredToday, 0);
});

test("all employees receive different prompts even when the same tiers unlock simultaneously", async () => {
  const f = fixture(), people = TEAM.filter(p => p.id !== "owner").map(p => p.id), prompts = new Set();
  const random = mock.method(crypto, "getRandomValues", values => values.fill(0));
  try {
    for (let slot = 0; slot < 3; slot++) {
      mock.timers.setTime(now + slot * QUIZ_INTERVAL_MS);
      const devices = await Promise.all(people.map(async user => Promise.all([f.call(user), f.call(user)])));
      const questions = devices.map(([first, second]) => {
        assert.equal(first.status, 200); assert.equal(second.status, 200);
        assert.deepEqual(current(first.data).question, current(second.data).question);
        const q = current(first.data).question;
        assert.equal(q.tier, QUIZ_TIERS[slot].id);
        assert.ok(!("correctOptionId" in q));
        assert.ok(!prompts.has(q.prompt)); prompts.add(q.prompt);
        return q;
      });
      assert.equal((await f.call(people[1], "/engagement/answer", {
        day: today, tier: questions[0].tier, questionId: questions[0].id, optionId: questions[0].options[0].id,
      })).status, 409);
      await Promise.all(people.map(async user => {
        const input = await offered(f, user), result = await f.call(user, "/engagement/answer", input);
        assert.equal(result.status, 200); assert.equal(result.data.answeredToday, slot + 1);
        assert.equal(result.data.available, false);
      }));
    }
    assert.equal(prompts.size, people.length * 3);
    for (const user of people) assert.equal((await f.call(user)).data.summary.points, 30);
    assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM team_quiz_offers").get().n, people.length * 3);
  } finally { random.mock.restore(); }
});

test("shared unanswered legacy offers become distinct without changing submitted answers or points", async () => {
  const f = fixture(), q = dailyQuestion(today, "easy"), people = TEAM.filter(p => p.id !== "owner").map(p => p.id);
  for (const user of people) f.DB.sqlite.prepare("INSERT INTO team_quiz_offers (user_id, day, slot, tier, offered_at, dismissed_at, data) VALUES (?, ?, 1, ?, ?, ?, ?)")
    .run(user, today, q.tier, now, now, JSON.stringify(q));
  const completed = { day: today, tier: q.tier, createdAt: new Date(now).toISOString(), question: publicQuestion(q), selectedOptionId: q.correctOptionId,
    correctOptionId: q.correctOptionId, correct: true, points: q.points, explanation: q.explanation, source: q.source };
  const snapshot = JSON.stringify(completed);
  f.DB.sqlite.prepare("INSERT INTO team_quiz_attempts (user_id, day, tier, correct, points, created_at, data) VALUES (?, ?, ?, 1, ?, ?, ?)").run(people[0], today, q.tier, q.points, now, snapshot);
  const results = await Promise.all(people.map(user => f.call(user)));
  const questions = results.map(r => { assert.equal(r.status, 200); return current(r.data).question; });
  assert.equal(new Set(questions.map(item => item.prompt)).size, people.length);
  assert.equal(results[0].data.summary.points, q.points);
  assert.equal(f.DB.sqlite.prepare("SELECT data FROM team_quiz_attempts").get().data, snapshot);
  for (let i = 1; i < people.length; i++) {
    assert.equal(results[i].data.questionDue, true);
    assert.equal(results[i].data.summary.points, 0);
    assert.equal((await f.call(people[i], "/engagement/answer", answer(today, true, "easy"))).status, 409);
    assert.deepEqual(current((await f.call(people[i])).data).question, questions[i]);
    assert.equal((await f.call(people[i], "/engagement/answer", await offered(f, people[i]))).data.summary.points, q.points);
  }
});

test("already answered questions without offers are excluded from new reservations", async () => {
  const f = fixture(), q = employeeQuestionCandidates(today, "easy", "jordyn")[0];
  const snapshot = JSON.stringify({ day: today, tier: "easy", createdAt: new Date(now).toISOString(), question: publicQuestion(q), points: 5, correct: true });
  f.DB.sqlite.prepare("INSERT INTO team_quiz_attempts (user_id, day, tier, correct, points, created_at, data) VALUES ('rayne', ?, 'easy', 1, 5, ?, ?)").run(today, now, snapshot);
  const random = mock.method(crypto, "getRandomValues", values => values.fill(0));
  try {
    const state = (await f.call("jordyn")).data;
    assert.equal(current(state).question.tier, "easy");
    assert.notEqual(current(state).question.prompt, q.prompt);
    assert.deepEqual(current((await f.call("jordyn")).data).question, current(state).question);
  } finally { random.mock.restore(); }
});

test("one question per two hours, one of each tier, with no banked instant backlog", async () => {
  const f = fixture(), tiers = [], times = [now, now + QUIZ_INTERVAL_MS, now + 7 * 3600000];
  for (let i = 0; i < 3; i++) {
    mock.timers.setTime(times[i]);
    const input = await offered(f, "jordyn"); tiers.push(input.tier);
    const result = await f.call("jordyn", "/engagement/answer", { ...input, points: 999, userId: "owner" });
    assert.equal(result.status, 200);
    assert.equal(result.data.available, false);
    assert.equal(result.data.questionDue, false);
    assert.equal(result.data.answeredToday, i + 1);
    assert.equal(current(result.data).attempt.points, QUIZ_TIERS.find(t => t.id === input.tier).points);
    assert.equal(result.data.nextQuestionAt, i < 2 ? times[i] + QUIZ_INTERVAL_MS : null);
    if (i < 2) {
      const lockedTier = QUIZ_TIERS.find(t => !tiers.includes(t.id)).id;
      assert.equal((await f.call("jordyn", "/engagement/answer", { ...answer(today, true, lockedTier), serverNow: times[i] + QUIZ_INTERVAL_MS })).status, 409);
      mock.timers.setTime(times[i] + QUIZ_INTERVAL_MS - 1);
      assert.equal((await f.call("jordyn")).data.available, false);
    }
  }
  assert.equal(new Set(tiers).size, 3);
  const final = (await f.call("jordyn")).data;
  assert.equal(final.summary.points, 30);
  assert.equal(final.summary.answered, 3);
  assert.equal(final.quiz.length, 3);
  assert.equal(final.history.length, 3);
  assert.equal(reportMember((await f.call("owner", "/engagement/team")).data).today.length, 3);
});

test("wrong answers stay final; concurrent submissions cannot duplicate a reward", async () => {
  const f = fixture(), wrong = await offered(f, "sorayia", false);
  const first = await f.call("sorayia", "/engagement/answer", wrong);
  const retry = await f.call("sorayia", "/engagement/answer", { ...wrong, optionId: "option-0" });
  assert.deepEqual(current(retry.data).attempt, current(first.data).attempt);
  assert.equal(retry.data.summary.points, 0);
  assert.equal(retry.data.summary.incorrect, 1);
  const input = await offered(f, "akiva");
  const responses = await Promise.all(Array.from({ length: 8 }, () => f.call("akiva", "/engagement/answer", input)));
  assert.ok(responses.every(r => r.status === 200));
  const final = (await f.call("akiva")).data;
  assert.equal(final.summary.points, QUIZ_TIERS.find(t => t.id === input.tier).points);
  assert.equal(final.summary.answered, 1);
});

test("an issued snapshot survives a later question-bank deployment", async () => {
  const f = fixture(), input = await offered(f, "jordyn");
  const row = f.DB.sqlite.prepare("SELECT data FROM team_quiz_offers").get(), original = JSON.parse(row.data);
  original.id = "v3:earlier-deployment"; original.prompt = "An earlier published question";
  f.DB.sqlite.prepare("UPDATE team_quiz_offers SET data = ?").run(JSON.stringify(original));
  assert.equal(current((await f.call("jordyn")).data).question.prompt, original.prompt);
  assert.equal((await f.call("jordyn", "/engagement/answer", { ...input, questionId: original.id })).status, 200);
  assert.equal(current((await f.call("jordyn")).data).attempt.question.id, original.id);
});

test("Eastern midnight resets tiers, including DST, without misreporting the next unlock", async () => {
  for (const [lastMinute, midnight, day, nextDay] of [
    ["2026-10-16T03:59:59Z", "2026-10-16T04:00:00Z", today, "2026-10-16"],
    ["2026-11-02T04:59:59Z", "2026-11-02T05:00:00Z", "2026-11-01", "2026-11-02"],
    ["2027-03-15T03:59:59Z", "2027-03-15T04:00:00Z", "2027-03-14", "2027-03-15"],
  ]) {
    const f = fixture(); mock.timers.setTime(Date.parse(lastMinute));
    const input = await offered(f, "rayne");
    assert.equal(input.day, day);
    const saved = (await f.call("rayne", "/engagement/answer", input)).data;
    assert.equal(saved.nextQuestionAt, Date.parse(midnight));
    mock.timers.setTime(Date.parse(midnight));
    const fresh = (await f.call("rayne")).data;
    assert.equal(fresh.day, nextDay);
    assert.equal(fresh.answeredToday, 0);
    assert.equal(fresh.available, true);
    assert.equal(fresh.summary.points, saved.summary.points);
    assert.equal((await f.call("rayne", "/engagement/answer", input)).status, 409);
  }
});

test("quiz and mood intervals measure elapsed hours across daylight-saving changes", async () => {
  for (const start of ["2026-11-01T05:30:00Z", "2027-03-14T06:30:00Z"]) {
    const f = fixture(), time = Date.parse(start); mock.timers.setTime(time);
    const input = await offered(f, "rayne");
    const saved = (await f.call("rayne", "/engagement/answer", input)).data;
    assert.equal(saved.nextQuestionAt, time + QUIZ_INTERVAL_MS);
    const checked = (await f.call("rayne", "/engagement/mood", mood())).data;
    assert.ok(checked.nextMoodAt >= time + TEMP_CHECK_MIN_MS && checked.nextMoodAt <= time + TEMP_CHECK_MAX_MS);
    mock.timers.setTime(time + QUIZ_INTERVAL_MS - 1);
    assert.equal((await f.call("rayne")).data.available, false);
    mock.timers.setTime(time + QUIZ_INTERVAL_MS);
    assert.equal((await f.call("rayne")).data.available, true);
  }
});

test("invalid moods, stale IDs, forged tiers and options cannot alter records", async () => {
  const f = fixture(), input = await offered(f, "jordyn");
  assert.equal((await f.call("jordyn", "/engagement/mood", mood("diagnosis"))).status, 400);
  assert.equal((await f.call("jordyn", "/engagement/mood", { mood: "happy", requestId: "bad" })).status, 400);
  assert.equal((await f.call("jordyn", "/engagement/answer", { ...input, optionId: "correct" })).status, 400);
  assert.equal((await f.call("jordyn", "/engagement/answer", { ...input, questionId: "other" })).status, 409);
  assert.equal((await f.call("jordyn", "/engagement/answer", { ...input, tier: "expert" })).status, 409);
  assert.equal((await f.call("jordyn", "/engagement/answer", { ...input, day: "2099-01-01" })).status, 409);
  assert.equal((await f.call("jordyn", "/engagement/dismiss", { kind: "question", day: today, questionId: "other" })).status, 409);
  assert.equal((await f.call("jordyn", "/engagement/unknown", {})).status, 404);
  assert.equal((await f.call("jordyn")).data.summary.answered, 0);
});

test("migration preserves old snapshots and points; late old-worker answers start the same cooldown", async () => {
  const f = fixture();
  const original = { day: today, createdAt: new Date(now).toISOString(), question: { id: "v1:original", day: today, category: "Video", prompt: "Original question", options: [{ id: "a", text: "Original answer" }] }, selectedOptionId: "a", correctOptionId: "a", correct: true, points: 10, explanation: "Original explanation", source: { label: "Original source", url: "https://example.invalid/reference" } };
  const json = JSON.stringify(original);
  f.DB.sqlite.prepare("INSERT INTO team_creative_attempts VALUES (?, ?, ?, ?, ?, ?)").run("jordyn", today, 1, 10, now, json);
  const first = (await f.call("jordyn")).data;
  assert.equal(first.summary.points, 10);
  assert.equal(first.available, false);
  assert.equal(first.nextQuestionAt, now + QUIZ_INTERVAL_MS);
  assert.equal(current(first).attempt.explanation, original.explanation);
  assert.equal(current(first).question.id, "v1:original");
  mock.timers.setTime(now + QUIZ_INTERVAL_MS);
  const input = await offered(f, "jordyn"); assert.notEqual(input.tier, "medium");
  await f.call("jordyn", "/engagement/answer", input);
  const points = (await f.call("jordyn")).data.summary.points;
  migrations.slice(5, 8).forEach(sql => f.DB.sqlite.exec(sql));
  assert.equal((await f.call("jordyn")).data.summary.points, points);
  assert.equal(f.DB.sqlite.prepare("SELECT data FROM team_creative_attempts").get().data, json);
  // Seed a pre-migration database and run the additive account migration twice.
  const old = new DatabaseSync(":memory:"); migrations.slice(0, 6).forEach(sql => old.exec(sql));
  old.prepare("INSERT INTO team_quiz_attempts (user_id, day, tier, correct, points, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)").run("amia", today, "medium", 1, 10, now, json);
  migrations.slice(6).forEach(sql => old.exec(sql)); old.exec(migrations[6]);
  assert.equal(old.prepare("SELECT points FROM team_reward_accounts").get().points, 10);
});

test("owner can adjust points and award SmoothStars without typing a reason", async () => {
  const f = fixture();
  let response = await f.call("owner", "/engagement/rewards", adjustment(495));
  assert.equal(response.status, 200);
  assert.equal(reportMember(response.data).summary.points, 495);
  assert.equal(reportMember(response.data).summary.answered, 0);
  const input = await offered(f, "jordyn"); await f.call("jordyn", "/engagement/answer", input);
  const afterQuiz = (await f.call("jordyn")).data.summary;
  assert.equal(afterQuiz.earnedStars, 1);
  response = await f.call("owner", "/engagement/rewards", adjustment(1, { kind: "star" }));
  assert.equal(reportMember(response.data).summary.stars, 2);
  assert.equal(reportMember(response.data).summary.awardedStars, 1);
  assert.equal(reportMember(response.data).summary.points, afterQuiz.points);
  response = await f.call("owner", "/engagement/rewards", adjustment(-80));
  assert.equal(reportMember(response.data).summary.points, afterQuiz.points - 80);
  assert.equal(reportMember(response.data).summary.stars, 2);
  assert.equal(reportMember(response.data).summary.goal, 1000);
  await f.call("owner", "/engagement/rewards", adjustment(80));
  const mine = (await f.call("jordyn")).data;
  assert.equal(mine.summary.stars, 2); // Re-adding removed points doesn't mint extra stars.
  assert.deepEqual(mine.rewards, []); // Administrative activity stays owner-only.
  const owner = reportMember((await f.call("owner", "/engagement/team")).data);
  assert.equal(owner.rewards.length, 4);
  assert.ok(owner.rewards.every(reward => reward.reason === "Adjusted by Smooth"));
  assert.equal((await f.call("rayne", "/engagement?userId=jordyn")).data.rewards.length, 0);
  assert.equal((await f.call("rayne")).data.summary.stars, 0);
  assert.equal(f.alerts.length, 0);
});

test("only the owner can administer valid adjustments for active employees", async () => {
  const f = fixture();
  for (const user of ["jordyn", "sync"]) assert.equal((await f.call(user, "/engagement/rewards", adjustment())).status, 403);
  for (const extra of [{userId:"owner"}, {userId:"unknown"}, {amount:0}, {amount:1.5}, {amount:10001}, {kind:"star",amount:2}, {kind:"star",amount:-10001}, {reason:"x".repeat(241)}, {requestId:"bad"}, {kind:"bad"}]) assert.equal((await f.call("owner", "/engagement/rewards", adjustment(10, extra))).status, 400);
  f.env.TEAM_TOKEN_HASHES = JSON.stringify(Object.fromEntries(Object.entries(hashes).filter(([id]) => id !== "amia")));
  assert.equal((await f.call("owner", "/engagement/rewards", adjustment(10, { userId: "amia" }))).status, 400);
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM team_reward_changes").get().n, 0);
});

test("reward retries are idempotent and conflicting reuse cannot change another person", async () => {
  const f = fixture(), input = adjustment(25);
  const responses = await Promise.all(Array.from({ length: 8 }, () => f.call("owner", "/engagement/rewards", input)));
  assert.ok(responses.every(r => r.status === 200));
  assert.equal((await f.call("owner", "/engagement/rewards", { ...input, reason: " " })).status, 200);
  assert.equal((await f.call("jordyn")).data.summary.points, 25);
  assert.equal((await f.call("owner", "/engagement/rewards", { ...input, userId: "rayne" })).status, 409);
  assert.equal((await f.call("owner", "/engagement/rewards", { ...input, amount: 50 })).status, 409);
  const star = adjustment(1, { kind: "star" });
  await Promise.all(Array.from({ length: 5 }, () => f.call("owner", "/engagement/rewards", star)));
  assert.equal((await f.call("jordyn")).data.summary.stars, 1);
  assert.equal((await f.call("rayne")).data.summary.points, 0);
});

test("concurrent deductions cannot make a negative balance or leave a phantom ledger entry", async () => {
  const f = fixture();
  await f.call("owner", "/engagement/rewards", adjustment(10));
  const result = await Promise.all([f.call("owner", "/engagement/rewards", adjustment(-7)), f.call("owner", "/engagement/rewards", adjustment(-7))]);
  assert.deepEqual(result.map(r => r.status).sort(), [200, 409]);
  assert.equal((await f.call("jordyn")).data.summary.points, 3);
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM team_reward_changes").get().n, 2);
});

test("the question bank spans studio disciplines with unique choices and exact shutter math", () => {
  assert.ok(QUESTION_BANK.length >= 40);
  assert.equal(new Set(QUESTION_BANK.map(q => q.id)).size, QUESTION_BANK.length);
  assert.equal(new Set(QUESTION_BANK.map(q => q.prompt)).size, QUESTION_BANK.length);
  for (const difficulty of QUIZ_TIERS) {
    assert.ok(QUESTION_BANKS[difficulty.id].length >= TEAM.filter(p => p.id !== "owner").length);
    assert.ok(new Set(QUESTION_BANKS[difficulty.id].map(q => q.category)).size >= 5);
    for (let i = 0; i < QUESTION_BANKS[difficulty.id].length; i++) {
      const day = new Date(Date.parse(today) + i * 86400000).toISOString().slice(0,10), q = dailyQuestion(day, difficulty.id);
      assert.equal(q.options.length, 4);
      assert.equal(new Set(q.options.map(o => o.text)).size, 4);
      assert.ok(q.options.some(o => o.id === q.correctOptionId));
      assert.deepEqual(q, dailyQuestion(day, difficulty.id));
      assert.equal(q.points, difficulty.points);
      assert.deepEqual(Object.keys(publicQuestion(q)).sort(), ["category", "day", "id", "options", "points", "prompt", "tier"]);
      assert.match(q.source.url, /^https:\/\//);
    }
  }
  assert.equal(QUESTION_BANK.find(q => q.id === "frame-rate-125").correct, "62.5 fps");
  assert.equal(QUESTION_BANK.find(q => q.id === "shutter-60").correct, "1/120 second");
  assert.throws(() => dailyQuestion("2026-02-30"));
});

test("Home-only prompt order and star goals account for permanent and awarded stickers", () => {
  assert.equal(MOODS.length, 6);
  assert.equal(nextEngagementPrompt({ moodDue: true, questionDue: true, available: true }), "mood");
  assert.equal(nextEngagementPrompt({ moodDue: false, questionDue: true, available: true }), "question");
  assert.equal(nextEngagementPrompt({ moodDue: false, questionDue: true, available: false }), null);
  assert.equal(nextEngagementPrompt({ moodDue: true, questionDue: true, available: true }, false), null);
  assert.equal(starProgress(490).remaining, 10);
  assert.equal(starProgress(499).stars, 0);
  assert.equal(starProgress(500).stars, 1);
  assert.equal(starProgress(1030).progress, 30);
  assert.deepEqual(starProgress(30, 550, 2), { points: 30, stars: 3, earnedStars: 1, awardedStars: 2, removedStars: 0, progress: 0, goal: 1000, remaining: 970 });
});

test("the 500-point migration retains old stars, removals, and progress without re-awarding milestones", async () => {
  let originalLedger;
  const f = fixture(db => {
    const insert = db.prepare("INSERT INTO team_reward_changes (id, user_id, kind, amount, reason, actor, created_at) VALUES (?, ?, ?, ?, 'Synthetic prior reward', 'owner', ?)");
    insert.run('old-points', 'jordyn', 'points', 250, now);
    insert.run('old-award', 'jordyn', 'star', 1, now);
    insert.run('old-removal', 'jordyn', 'star', -2, now);
    insert.run('old-deduction', 'jordyn', 'points', -50, now);
    insert.run('old-progress', 'rayne', 'points', 50, now);
    originalLedger = db.prepare('SELECT * FROM team_reward_changes ORDER BY id').all();
  });
  assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM team_reward_changes ORDER BY id').all(), originalLedger);
  let state = (await f.call('jordyn')).data.summary;
  assert.equal(state.points, 200);
  assert.equal(state.stars, 1);
  assert.equal(state.earnedStars, 2);
  assert.equal(state.awardedStars, 1);
  assert.equal(state.removedStars, 2);
  assert.equal(state.goal, 700);
  assert.equal(state.remaining, 500);
  const partial = (await f.call('rayne')).data.summary;
  assert.equal(partial.progress, 50);
  assert.equal(partial.goal, 500);
  assert.equal(partial.remaining, 450);
  await f.call('owner', '/engagement/rewards', adjustment(499));
  assert.equal((await f.call('jordyn')).data.summary.stars, 1);
  await f.call('owner', '/engagement/rewards', adjustment(1));
  state = (await f.call('jordyn')).data.summary;
  assert.equal(state.stars, 2);
  assert.equal(state.goal, 1200);
  await f.call('owner', '/engagement/rewards', adjustment(-500));
  await f.call('owner', '/engagement/rewards', adjustment(500));
  assert.equal((await f.call('jordyn')).data.summary.stars, 2);
  assert.equal((await f.call('owner', '/engagement/rewards', adjustment(-3, { kind: 'star' }))).status, 409);
  assert.equal((await f.call('owner', '/engagement/rewards', adjustment(-2, { kind: 'star' }))).status, 200);
  assert.equal((await f.call('jordyn')).data.summary.stars, 0);
});

test("owner resets only today's Temp Checks and a replay cannot hide a new check-in", async () => {
  const f = fixture(), yesterday = now - 86400000;
  f.DB.sqlite.prepare("INSERT INTO team_mood_checkins (id, user_id, mood, created_at) VALUES ('earlier', 'jordyn', 'okay', ?)").run(yesterday);
  const first = mood('happy'); await f.call('jordyn', '/engagement/mood', first);
  const input = await resetInput(f, 'mood');
  f.DB.queries = 0;
  const result = await f.call('owner', '/engagement/reset', input);
  assert.equal(result.status, 200); assert.ok(f.DB.queries <= 50);
  assert.equal(reportMember(result.data).resets[0].reason, 'Reset by Smooth');
  assert.equal((await f.call('owner', '/engagement/reset', {...input, reason:' '})).status, 200);
  assert.deepEqual(reportMember(result.data).moods.map(m => m.id), ['earlier']);
  const due = (await f.call('jordyn')).data;
  assert.equal(due.moodDue, true); assert.equal(due.summary.points, 0);
  assert.ok(due.moodRevision > input.moodRevision);
  await f.call('jordyn', '/engagement/mood', first); // stale request stays idempotent
  assert.equal((await f.call('jordyn')).data.moodDue, true);
  mock.timers.setTime(now + 1000);
  await f.call('jordyn', '/engagement/mood', mood('chilling'));
  const fresh = (await f.call('jordyn')).data;
  await Promise.all(Array.from({length: 4}, () => f.call('owner', '/engagement/reset', input)));
  assert.equal((await f.call('jordyn')).data.lastMood.id, fresh.lastMood.id);
  assert.equal((await f.call('jordyn')).data.moodDue, false);
  assert.equal((await f.call('owner', '/engagement/reset', {...input, requestId: crypto.randomUUID()})).status, 409);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM team_engagement_resets').get().n, 1);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM team_mood_checkins').get().n, 3);
});

test("resetting a correct question reverses its points once and permits one new scored attempt", async () => {
  const f = fixture(), original = await offered(f, 'jordyn');
  const answered = (await f.call('jordyn', '/engagement/answer', original)).data;
  const input = await resetInput(f);
  mock.timers.setTime(now + 1000);
  const resets = await Promise.all(Array.from({length: 6}, () => f.call('owner', '/engagement/reset', input)));
  assert.ok(resets.every(r => r.status === 200));
  const state = (await f.call('jordyn')).data;
  assert.equal(state.summary.points, 0); assert.equal(state.summary.answered, 0);
  assert.equal(state.available, true); assert.equal(state.questionDue, true);
  assert.notEqual(state.currentQuestionId, original.questionId);
  assert.equal(current(state).question.prompt, current(answered).question.prompt);
  assert.equal((await f.call('jordyn', '/engagement/answer', original)).status, 409);
  const archived = JSON.parse(f.DB.sqlite.prepare('SELECT previous_data FROM team_engagement_resets').get().previous_data);
  assert.deepEqual(archived.attempt, current(answered).attempt);
  const retry = await offered(f, 'jordyn');
  const results = await Promise.all(Array.from({length: 6}, () => f.call('jordyn', '/engagement/answer', retry)));
  assert.ok(results.every(r => r.status === 200), JSON.stringify({results, errors:f.DB.errors}));
  const final = (await f.call('jordyn')).data;
  assert.equal(final.summary.points, answered.summary.points); assert.equal(final.summary.answered, 1);
  await f.call('owner', '/engagement/reset', input); // delayed owner retry preserves the new answer
  assert.deepEqual((await f.call('jordyn')).data.summary, final.summary);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM team_reward_changes').get().n, 1);
});

test("resetting an earlier question holds another pending question until two hours after the retry", async () => {
  const f = fixture(), first = await offered(f, 'jordyn');
  await f.call('jordyn', '/engagement/answer', first);
  mock.timers.setTime(now + QUIZ_INTERVAL_MS);
  const second = await offered(f, 'jordyn'), input = await resetInput(f, 'question', 'jordyn', first.tier);
  assert.equal((await f.call('owner', '/engagement/reset', input)).status, 200);
  let state = (await f.call('jordyn')).data;
  assert.equal(current(state).question.tier, first.tier); assert.equal(state.quiz.length, 1);
  assert.equal((await f.call('jordyn', '/engagement/answer', second)).status, 409);
  mock.timers.setTime(now + QUIZ_INTERVAL_MS + 1000);
  await f.call('jordyn', '/engagement/answer', await offered(f, 'jordyn'));
  state = (await f.call('jordyn')).data;
  assert.equal(state.available, false); assert.equal(state.nextQuestionAt, now + 2 * QUIZ_INTERVAL_MS + 1000);
  mock.timers.setTime(state.nextQuestionAt);
  assert.equal((await f.call('jordyn')).data.currentQuestionId, second.questionId);
  await f.call('jordyn', '/engagement/answer', second);
  mock.timers.setTime(Date.now() + QUIZ_INTERVAL_MS);
  await f.call('jordyn', '/engagement/answer', await offered(f, 'jordyn'));
  const final = (await f.call('jordyn')).data;
  assert.equal(final.summary.points, 30); assert.equal(final.answeredToday, 3); assert.equal(final.available, false);
});

test("unanswered and incorrect questions can be reset, and depleted points never become negative", async () => {
  const f = fixture(); await offered(f, 'jordyn');
  let input = await resetInput(f);
  await f.call('jordyn', '/engagement/dismiss', {kind:'question', day:today, questionId:input.questionId});
  assert.equal((await f.call('owner', '/engagement/reset', input)).status, 200);
  assert.equal((await f.call('jordyn')).data.questionDue, true);
  assert.equal((await f.call('jordyn', '/engagement/answer', await offered(f, 'jordyn', false))).status, 200);
  input = await resetInput(f); assert.equal((await f.call('owner', '/engagement/reset', input)).status, 200);
  assert.equal((await f.call('jordyn')).data.summary.incorrect, 0);
  const good = await offered(f, 'jordyn'); assert.equal((await f.call('jordyn', '/engagement/answer', good)).status, 200);
  const earned = (await f.call('jordyn')).data.summary.points;
  assert.ok(earned > 0);
  assert.equal((await f.call('owner', '/engagement/rewards', adjustment(-earned))).status, 200);
  input = await resetInput(f); assert.equal((await f.call('owner', '/engagement/reset', input)).status, 200);
  assert.equal((await f.call('jordyn')).data.summary.points, 0);
  assert.equal((await f.call('jordyn', '/engagement/answer', await offered(f, 'jordyn'))).status, 200);
  assert.equal((await f.call('jordyn')).data.summary.points, earned);
});

test("today's imported legacy question can be reset without reimporting its old result", async () => {
  const f = fixture(), q = dailyQuestion(today, 'medium');
  const old = {day:today, tier:'medium', createdAt:new Date(now).toISOString(), question:publicQuestion(q), selectedOptionId:q.correctOptionId, correctOptionId:q.correctOptionId, correct:true, points:10, explanation:q.explanation, source:q.source};
  f.DB.sqlite.prepare('INSERT INTO team_creative_attempts VALUES (?, ?, 1, 10, ?, ?)').run('jordyn', today, now, JSON.stringify(old));
  f.DB.sqlite.prepare('INSERT INTO team_creative_attempts VALUES (?, ?, 1, 10, ?, ?)').run('rayne', today, now, JSON.stringify(old));
  const input = await resetInput(f);
  assert.equal(input.questionId, q.id);
  assert.equal((await f.call('owner', '/engagement/reset', input)).status, 200);
  assert.equal((await f.call('jordyn')).data.summary.points, 0);
  assert.equal((await f.call('jordyn')).data.answeredToday, 0);
  assert.equal(current((await f.call('jordyn')).data).question.prompt, q.prompt);
  await f.call('jordyn', '/engagement/answer', await offered(f, 'jordyn'));
  assert.equal((await f.call('jordyn')).data.summary.points, 10);
  assert.equal(f.DB.sqlite.prepare('SELECT data FROM team_creative_attempts').get().data, JSON.stringify(old));
});

test("employee resets are owner-only, current-day only, and reject stale targets and reused IDs", async () => {
  const f = fixture(), answerInput = await offered(f, 'jordyn'), input = await resetInput(f);
  for (const user of ['jordyn', 'rayne', 'sync']) assert.equal((await f.call(user, '/engagement/reset', input)).status, 403);
  for (const extra of [{userId:'owner'}, {userId:'unknown'}, {tier:'expert'}, {reason:'x'.repeat(241)}, {requestId:'bad'}, {kind:'unknown'}]) assert.equal((await f.call('owner', '/engagement/reset', {...input,...extra})).status, 400);
  assert.equal((await f.call('owner', '/engagement/reset', {...input,day:'2026-10-14'})).status, 409);
  await f.call('jordyn', '/engagement/answer', answerInput);
  assert.equal((await f.call('owner', '/engagement/reset', input)).status, 409);
  const fresh = await resetInput(f);
  assert.equal((await f.call('owner', '/engagement/reset', fresh)).status, 200);
  assert.equal((await f.call('owner', '/engagement/reset', {...fresh,reason:'Different action'})).status, 409);
  mock.timers.setTime(Date.parse('2026-10-16T04:00:00Z'));
  assert.equal((await f.call('owner', '/engagement/reset', fresh)).status, 409);
});

test("a simultaneous answer and reset cannot apply an unseen score reversal or accept an old question", async () => {
  const f = fixture(), answerInput = await offered(f, 'jordyn'), input = await resetInput(f);
  const [reset, answerResult] = await Promise.all([f.call('owner', '/engagement/reset', input), f.call('jordyn', '/engagement/answer', answerInput)]);
  assert.deepEqual([reset.status,answerResult.status].sort(), [200,409]);
  const state = (await f.call('jordyn')).data;
  if (reset.status === 200) { assert.equal(state.summary.points,0); assert.equal(state.available,true); assert.notEqual(state.currentQuestionId,answerInput.questionId); }
  else { assert.equal(state.available,false); assert.equal(state.summary.answered,1); }
});

test("SmoothStars can be removed from earned and awarded totals without reducing points or regrowing on refresh", async () => {
  const f = fixture(); await f.call('owner','/engagement/rewards',adjustment(500));
  await f.call('owner','/engagement/rewards',adjustment(1,{kind:'star'}));
  const remove = adjustment(-2,{kind:'star'});
  const responses = await Promise.all(Array.from({length:5},()=>f.call('owner','/engagement/rewards',remove)));
  assert.ok(responses.every(r=>r.status===200));
  let summary = (await f.call('jordyn')).data.summary;
  assert.equal(summary.stars,0); assert.equal(summary.removedStars,2); assert.equal(summary.points,500); assert.equal(summary.goal,1000);
  assert.equal((await f.call('owner','/engagement/rewards',adjustment(-1,{kind:'star'}))).status,409);
  await f.call('owner','/engagement/rewards',adjustment(-50)); await f.call('owner','/engagement/rewards',adjustment(50));
  assert.equal((await f.call('jordyn')).data.summary.stars,0);
  await f.call('owner','/engagement/rewards',adjustment(500));
  summary = (await f.call('jordyn')).data.summary;
  assert.equal(summary.stars,1); assert.equal(summary.goal,1500);
  f.DB.queries=0; await f.call('owner','/engagement/rewards',adjustment(-1,{kind:'star'})); assert.ok(f.DB.queries<=50);
  assert.equal((await f.call('rayne')).data.summary.stars,0);
  assert.deepEqual((await f.call('jordyn')).data.rewards, []);
  assert.ok(reportMember((await f.call('owner', '/engagement/team')).data).rewards.some(r=>r.kind==='star'&&r.amount===-2));
});

test("competing star removals cannot take the collection below zero", async () => {
  const f=fixture(); await f.call('owner','/engagement/rewards',adjustment(1,{kind:'star'}));
  const results=await Promise.all([f.call('owner','/engagement/rewards',adjustment(-1,{kind:'star'})),f.call('owner','/engagement/rewards',adjustment(-1,{kind:'star'}))]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]); assert.equal((await f.call('jordyn')).data.summary.stars,0);
});

test("owner-control migration preserves all preexisting reward entries and balances", () => {
  const db=new DatabaseSync(':memory:'); migrations.slice(0,8).forEach(sql=>db.exec(sql));
  db.prepare("INSERT INTO team_reward_changes VALUES ('points', 'jordyn', 'points', 150, 'Synthetic old award', 'owner', ?)").run(now);
  db.prepare("INSERT INTO team_reward_changes VALUES ('star', 'jordyn', 'star', 1, 'Synthetic old star', 'owner', ?)").run(now);
  const ledger=db.prepare('SELECT * FROM team_reward_changes ORDER BY id').all(),before=db.prepare('SELECT * FROM team_reward_accounts').get();
  db.exec(migrations[8]);
  assert.deepEqual(db.prepare('SELECT * FROM team_reward_changes ORDER BY id').all(),ledger);
  assert.deepEqual({...db.prepare('SELECT * FROM team_reward_accounts').get()},{...before,removed_stars:0});
  db.close();
});
