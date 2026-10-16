import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test, { mock } from "node:test";
import worker from "../team-api/worker.mjs";
import { TEAM } from "../lib/team-schedule.mjs";
import { teamToken, tokenHash } from "../lib/team-auth.mjs";
import { TEMP_CHECK_INTERVAL_MS, QUIZ_INTERVAL_MS, MOODS, QUIZ_TIERS, nextEngagementPrompt, starProgress } from "../lib/team-engagement.mjs";
import { dailyQuestion, publicQuestion, QUESTION_BANK, QUESTION_BANKS } from "../team-api/creative-questions.mjs";

const migrations = await Promise.all(["0000_brief_ravenous.sql", "0001_initial_state.sql", "0002_guideline_questions.sql", "0003_work_preferences.sql", "0004_team_engagement.sql", "0005_daily_quiz_tiers.sql", "0006_paced_quizzes_rewards.sql"].map(name => readFile(new URL(`../team-api/migrations/${name}`, import.meta.url), "utf8")));
const tokens = Object.fromEntries(await Promise.all([...TEAM.map(p => p.id), "sync"].map(async id => [id, await teamToken(`synthetic-engagement-test-only-${id}`, id)])));
const hashes = Object.fromEntries(await Promise.all(Object.entries(tokens).map(async ([id, token]) => [id, await tokenHash(token)])));
const now = Date.parse("2026-10-15T17:00:00Z"), today = "2026-10-15";
mock.timers.enable({ apis: ["Date"], now });
test.beforeEach(() => mock.timers.setTime(now));
test.after(() => mock.timers.reset());

class D1 {
  constructor() { this.sqlite = new DatabaseSync(":memory:"); migrations.forEach(sql => this.sqlite.exec(sql)); }
  prepare(sql) {
    const db = this.sqlite; let args = [];
    return { bind(...values) { args = values; return this; },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      runSync() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; },
      async run() { return this.runSync(); } };
  }
  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try { const results = statements.map(s => s.runSync()); this.sqlite.exec("COMMIT"); return results; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}
function fixture() {
  const DB = new D1(), env = { DB, TEAM_TOKEN_HASHES: JSON.stringify(hashes) }, alerts = [];
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
  return answer(state.day, correct, current(state).question.tier);
}
const adjustment = (amount = 10, extra = {}) => ({ requestId: crypto.randomUUID(), userId: "jordyn", kind: "points", amount, reason: "Synthetic test reward", ...extra });
const reportMember = (data, id = "jordyn") => data.members.find(p => p.userId === id);

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
  assert.equal((await f.call("owner", "/health")).data.engagementVersion, 3);
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

test("Temp Check keeps a three-hour server cooldown and idempotent concurrent retries", async () => {
  const f = fixture(), input = mood();
  const requests = await Promise.all(Array.from({ length: 6 }, () => f.call("amia", "/engagement/mood", input)));
  assert.ok(requests.every(r => r.status === 200));
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM team_mood_checkins").get().n, 1);
  assert.equal(requests[0].data.nextMoodAt, now + TEMP_CHECK_INTERVAL_MS);
  mock.timers.setTime(now + 60000);
  assert.equal((await f.call("amia", "/engagement/mood", input)).data.nextMoodAt, now + TEMP_CHECK_INTERVAL_MS);
  assert.equal((await f.call("amia", "/engagement/mood", mood("sad"))).status, 409);
  mock.timers.setTime(now + TEMP_CHECK_INTERVAL_MS - 1);
  assert.equal((await f.call("amia")).data.moodDue, false);
  mock.timers.setTime(now + TEMP_CHECK_INTERVAL_MS);
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
  const retry = await f.call("sorayia", "/engagement/answer", answer(today, true, wrong.tier));
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
    assert.equal(checked.nextMoodAt, time + TEMP_CHECK_INTERVAL_MS);
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
  migrations.slice(-2).forEach(sql => f.DB.sqlite.exec(sql));
  assert.equal((await f.call("jordyn")).data.summary.points, points);
  assert.equal(f.DB.sqlite.prepare("SELECT data FROM team_creative_attempts").get().data, json);
  // Seed a pre-migration database and run the additive account migration twice.
  const old = new DatabaseSync(":memory:"); migrations.slice(0, -1).forEach(sql => old.exec(sql));
  old.prepare("INSERT INTO team_quiz_attempts VALUES (?, ?, ?, ?, ?, ?, ?)").run("amia", today, "medium", 1, 10, now, json);
  old.exec(migrations.at(-1)); old.exec(migrations.at(-1));
  assert.equal(old.prepare("SELECT points FROM team_reward_accounts").get().points, 10);
});

test("owner can add/remove points and award a separate SmoothStar with a private reason history", async () => {
  const f = fixture();
  let response = await f.call("owner", "/engagement/rewards", adjustment(95));
  assert.equal(response.status, 200);
  assert.equal(reportMember(response.data).summary.points, 95);
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
  assert.equal(reportMember(response.data).summary.goal, 200);
  await f.call("owner", "/engagement/rewards", adjustment(80));
  const mine = (await f.call("jordyn")).data;
  assert.equal(mine.summary.stars, 2); // Re-adding removed points doesn't mint extra stars.
  assert.equal(mine.rewards.length, 4);
  assert.equal((await f.call("rayne", "/engagement?userId=jordyn")).data.rewards.length, 0);
  assert.equal((await f.call("rayne")).data.summary.stars, 0);
  assert.equal(f.alerts.length, 0);
});

test("only the owner can administer valid adjustments for active employees", async () => {
  const f = fixture();
  for (const user of ["jordyn", "sync"]) assert.equal((await f.call(user, "/engagement/rewards", adjustment())).status, 403);
  for (const extra of [{userId:"owner"}, {userId:"unknown"}, {amount:0}, {amount:1.5}, {amount:10001}, {kind:"star",amount:2}, {kind:"star",amount:-1}, {reason:" "}, {reason:"x".repeat(241)}, {requestId:"bad"}, {kind:"bad"}]) assert.equal((await f.call("owner", "/engagement/rewards", adjustment(10, extra))).status, 400);
  f.env.TEAM_TOKEN_HASHES = JSON.stringify(Object.fromEntries(Object.entries(hashes).filter(([id]) => id !== "amia")));
  assert.equal((await f.call("owner", "/engagement/rewards", adjustment(10, { userId: "amia" }))).status, 400);
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM team_reward_changes").get().n, 0);
});

test("reward retries are idempotent and conflicting reuse cannot change another person", async () => {
  const f = fixture(), input = adjustment(25);
  const responses = await Promise.all(Array.from({ length: 8 }, () => f.call("owner", "/engagement/rewards", input)));
  assert.ok(responses.every(r => r.status === 200));
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
  for (const difficulty of QUIZ_TIERS) {
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
  assert.equal(starProgress(90).remaining, 10);
  assert.equal(starProgress(100).stars, 1);
  assert.equal(starProgress(230).progress, 30);
  assert.deepEqual(starProgress(30, 150, 2), { points: 30, stars: 3, earnedStars: 1, awardedStars: 2, progress: 0, goal: 200, remaining: 170 });
});
