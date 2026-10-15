import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test, { mock } from "node:test";
import worker from "../team-api/worker.mjs";
import { TEAM } from "../lib/team-schedule.mjs";
import { teamToken, tokenHash } from "../lib/team-auth.mjs";
import { TEMP_CHECK_INTERVAL_MS, MOODS, nextEngagementPrompt, starProgress } from "../lib/team-engagement.mjs";
import { dailyQuestion, publicQuestion, QUESTION_BANK } from "../team-api/creative-questions.mjs";

const migrations = await Promise.all(["0000_brief_ravenous.sql", "0001_initial_state.sql", "0002_guideline_questions.sql", "0003_work_preferences.sql", "0004_team_engagement.sql"].map(name => readFile(new URL(`../team-api/migrations/${name}`, import.meta.url), "utf8")));
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
function answer(day = today, correct = true) {
  const q = dailyQuestion(day);
  return { day, questionId: q.id, optionId: correct ? q.correctOptionId : q.options.find(o => o.id !== q.correctOptionId).id };
}
const mood = (value = "happy", requestId = crypto.randomUUID()) => ({ mood: value, requestId });

test("check-ins require employee identity, restrict owner reports, and never reveal an unanswered answer", async () => {
  const f = fixture();
  assert.equal((await f.call(null)).status, 401);
  assert.equal((await f.call("sync")).status, 403);
  assert.equal((await f.call("owner")).status, 403);
  assert.equal((await f.call("jordyn", "/engagement/team")).status, 403);
  assert.equal((await f.call("owner", "/engagement/mood", mood())).status, 403);
  const first = await f.call("jordyn");
  assert.equal(first.status, 200);
  assert.equal(first.data.day, today);
  assert.equal(first.data.moodDue, true);
  assert.equal(first.data.questionDue, true);
  assert.equal(first.data.attempt, null);
  assert.equal(first.data.question.options.length, 4);
  assert.equal("correctOptionId" in first.data.question, false);
  assert.equal("explanation" in first.data.question, false);
  assert.equal("source" in first.data.question, false);
  assert.equal(first.data.summary.points, 0);
  assert.equal((await f.call("owner", "/health")).data.engagementVersion, 1);
});

test("moods are private, self-reported, and independent of points, assignments, and notifications", async () => {
  const f = fixture();
  assert.equal((await f.call("jordyn", "/engagement/mood", { ...mood("tired"), userId: "rayne", createdAt: "2099-01-01", points: 10000 })).status, 200);
  const mine = (await f.call("jordyn", "/engagement?user=rayne")).data;
  assert.equal(mine.lastMood.mood, "tired");
  assert.equal(mine.lastMood.createdAt, new Date(now).toISOString());
  assert.equal(mine.summary.points, 0);
  assert.equal((await f.call("rayne")).data.lastMood, null);
  const report = (await f.call("owner", "/engagement/team")).data;
  assert.equal(report.members.find(p => p.userId === "jordyn").moods[0].mood, "tired");
  assert.equal(report.members.find(p => p.userId === "rayne").moods.length, 0);
  assert.equal(f.DB.sqlite.prepare("SELECT revision FROM team_state").get().revision, 0);
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM team_assignments").get().n, 0);
  assert.equal(f.alerts.length, 0);
});

test("Temp Check observes a server-timed three-hour cooldown with idempotent retries", async () => {
  const f = fixture(), input = mood();
  const first = await f.call("amia", "/engagement/mood", input);
  assert.equal(first.data.nextMoodAt, now + TEMP_CHECK_INTERVAL_MS);
  assert.equal(first.data.moodDue, false);
  mock.timers.setTime(now + 60_000);
  const retry = await f.call("amia", "/engagement/mood", input);
  assert.equal(retry.status, 200);
  assert.equal(retry.data.nextMoodAt, first.data.nextMoodAt);
  assert.equal((await f.call("amia", "/engagement/mood", mood("sad"))).status, 409);
  mock.timers.setTime(now + TEMP_CHECK_INTERVAL_MS - 1);
  assert.equal((await f.call("amia")).data.moodDue, false);
  mock.timers.setTime(now + TEMP_CHECK_INTERVAL_MS);
  assert.equal((await f.call("amia")).data.moodDue, true);
  assert.equal((await f.call("amia", "/engagement/mood", mood("okay"))).status, 200);
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM team_mood_checkins").get().n, 2);
});

test("simultaneous devices cannot record two moods for the same period", async () => {
  const f = fixture();
  const responses = await Promise.all([f.call("terrill", "/engagement/mood", mood("happy")), f.call("terrill", "/engagement/mood", mood("sad"))]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM team_mood_checkins").get().n, 1);
  const g = fixture(), input = mood();
  const retries = await Promise.all([g.call("dacari", "/engagement/mood", input), g.call("dacari", "/engagement/mood", input)]);
  assert.ok(retries.every(r => r.status === 200));
  assert.equal(g.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM team_mood_checkins").get().n, 1);
});

test("dismissed prompts persist across devices without recording a mood or extending its timer", async () => {
  const f = fixture();
  const first = await f.call("rayne", "/engagement/dismiss", { kind: "mood" });
  assert.equal(first.data.lastMood, null);
  mock.timers.setTime(now + 5000);
  const second = await f.call("rayne", "/engagement/dismiss", { kind: "mood" });
  assert.equal(second.data.nextMoodAt, first.data.nextMoodAt);
  await f.call("rayne", "/engagement/dismiss", { kind: "question", day: today });
  const state = (await f.call("rayne")).data;
  assert.equal(state.questionDue, false);
  assert.equal(state.attempt, null);
  assert.equal(state.question.options.length, 4);
  assert.equal((await f.call("rayne", "/engagement/answer", answer())).data.summary.points, 10);
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM team_mood_checkins").get().n, 0);
});

test("daily scoring records correct and incorrect answers, and ignores forged users or points", async () => {
  const f = fixture();
  const correct = await f.call("jordyn", "/engagement/answer", { ...answer(), points: 999, correct: false, userId: "owner" });
  assert.equal(correct.status, 200);
  assert.equal(correct.data.summary.points, 10);
  assert.equal(correct.data.summary.correct, 1);
  assert.equal(correct.data.attempt.correct, true);
  assert.ok(correct.data.attempt.explanation);
  assert.equal(correct.data.questionDue, false);
  const incorrect = await f.call("amia", "/engagement/answer", { ...answer(today, false), correct: true, points: 999 });
  assert.equal(incorrect.data.summary.points, 0);
  assert.equal(incorrect.data.summary.incorrect, 1);
  assert.equal(incorrect.data.attempt.correct, false);
  assert.notEqual(incorrect.data.attempt.selectedOptionId, incorrect.data.attempt.correctOptionId);
  assert.equal((await f.call("rayne")).data.history.length, 0);
  const report = (await f.call("owner", "/engagement/team")).data;
  assert.equal(report.members.find(p => p.userId === "jordyn").today.correct, true);
  assert.equal(report.members.find(p => p.userId === "amia").today.correct, false);
});

test("the first daily answer is final and simultaneous attempts cannot duplicate points", async () => {
  const f = fixture();
  const first = await f.call("sorayia", "/engagement/answer", answer(today, false));
  const retry = await f.call("sorayia", "/engagement/answer", answer(today, true));
  assert.equal(retry.data.attempt.selectedOptionId, first.data.attempt.selectedOptionId);
  assert.equal(retry.data.summary.points, 0);
  const requests = await Promise.all(Array.from({ length: 8 }, () => f.call("akiva", "/engagement/answer", answer())));
  assert.ok(requests.every(r => r.status === 200));
  assert.equal((await f.call("akiva")).data.summary.points, 10);
  assert.equal((await f.call("akiva")).data.summary.answered, 1);
  const g = fixture();
  await Promise.all([g.call("rayne", "/engagement/answer", answer(today, false)), g.call("rayne", "/engagement/answer", answer(today, true))]);
  assert.equal((await g.call("rayne")).data.summary.answered, 1);
  assert.equal(g.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM team_creative_attempts").get().n, 1);
});

test("the daily question resets at Eastern midnight, not UTC midnight", async () => {
  const f = fixture();
  mock.timers.setTime(Date.parse("2026-10-16T03:59:59Z"));
  await f.call("jordyn", "/engagement/dismiss", { kind: "question", day: today });
  assert.equal((await f.call("jordyn")).data.day, today);
  await f.call("jordyn", "/engagement/answer", answer());
  mock.timers.setTime(Date.parse("2026-10-16T04:00:00Z"));
  const state = (await f.call("jordyn")).data;
  assert.equal(state.day, "2026-10-16");
  assert.equal(state.questionDue, true);
  assert.equal(state.attempt, null);
  assert.equal(state.summary.points, 10);
  assert.equal((await f.call("jordyn", "/engagement/answer", answer())).status, 409);
  assert.equal((await f.call("jordyn", "/engagement/dismiss", { kind: "question", day: today })).status, 409);
  assert.equal((await f.call("jordyn", "/engagement/answer", answer("2026-10-16"))).data.summary.points, 20);
});

test("Eastern fall and spring daylight-saving changes preserve daily limits and three elapsed hours", async () => {
  for (const [start, stillDay, nextDay, day] of [
    ["2026-11-01T05:30:00Z", "2026-11-02T04:59:59Z", "2026-11-02T05:00:00Z", "2026-11-01"],
    ["2027-03-14T06:30:00Z", "2027-03-15T03:59:59Z", "2027-03-15T04:00:00Z", "2027-03-14"],
  ]) {
    const f = fixture(); mock.timers.setTime(Date.parse(start));
    await f.call("rayne", "/engagement/answer", answer(day));
    const checked = (await f.call("rayne", "/engagement/mood", mood())).data;
    assert.equal(checked.nextMoodAt - Date.parse(start), TEMP_CHECK_INTERVAL_MS);
    mock.timers.setTime(Date.parse(stillDay));
    assert.equal((await f.call("rayne")).data.day, day);
    assert.equal((await f.call("rayne")).data.questionDue, false);
    mock.timers.setTime(Date.parse(nextDay));
    assert.equal((await f.call("rayne")).data.questionDue, true);
  }
});

test("ten correct days earn a permanent star; wrong answers never remove points", async () => {
  const f = fixture();
  for (let i = 0; i < 11; i++) {
    mock.timers.setTime(now + i * 86400_000);
    const day = new Date(now + i * 86400_000).toISOString().slice(0, 10);
    assert.equal((await f.call("terrill", "/engagement/answer", answer(day, i < 10))).status, 200);
  }
  const state = (await f.call("terrill")).data;
  assert.deepEqual(state.summary, { points: 100, stars: 1, progress: 0, goal: 200, remaining: 100, answered: 11, correct: 10, incorrect: 1 });
  assert.equal(state.history.length, 11);
  assert.equal(state.history[0].correct, false);
});

test("invalid check-ins, forged question dates, and invalid options cannot alter records", async () => {
  const f = fixture();
  assert.equal((await f.call("jordyn", "/engagement/mood", mood("diagnosis"))).status, 400);
  assert.equal((await f.call("jordyn", "/engagement/mood", { mood: "happy", requestId: "bad" })).status, 400);
  assert.equal((await f.call("jordyn", "/engagement/answer", { ...answer(), optionId: "correct" })).status, 400);
  assert.equal((await f.call("jordyn", "/engagement/answer", { ...answer(), questionId: "other" })).status, 409);
  assert.equal((await f.call("jordyn", "/engagement/answer", answer("2099-01-01"))).status, 409);
  assert.equal((await f.call("jordyn", "/engagement/dismiss", { kind: "all" })).status, 400);
  assert.equal((await f.call("jordyn", "/engagement/unknown", {})).status, 404);
  assert.equal((await f.call("jordyn")).data.summary.answered, 0);
  assert.equal((await f.call("jordyn")).data.lastMood, null);
});

test("question rotation has distinct valid choices, accurate 180-degree math, and no answer in its public projection", () => {
  assert.ok(QUESTION_BANK.length >= 40);
  assert.equal(new Set(QUESTION_BANK.map(q => q.id)).size, QUESTION_BANK.length);
  for (let i = 0; i < QUESTION_BANK.length; i++) {
    const day = new Date(Date.parse("2026-10-15") + i * 86400_000).toISOString().slice(0, 10);
    const q = dailyQuestion(day);
    assert.equal(q.options.length, 4);
    assert.equal(new Set(q.options.map(o => o.text)).size, 4);
    assert.ok(q.options.some(o => o.id === q.correctOptionId));
    assert.deepEqual(q, dailyQuestion(day));
    assert.deepEqual(Object.keys(publicQuestion(q)).sort(), ["category", "day", "id", "options", "prompt"]);
    assert.match(q.source.url, /^https:\/\//);
  }
  const exact = QUESTION_BANK.find(q => q.id === "frame-rate-125");
  assert.equal(exact.correct, "62.5 fps");
  assert.match(exact.explanation, /1\/120/);
  assert.equal(QUESTION_BANK.find(q => q.id === "shutter-60").correct, "1/120 second");
  assert.throws(() => dailyQuestion("2026-02-30"));
});

test("prompt ordering and star goals keep mood checks separate from scored questions", () => {
  assert.equal(MOODS.length, 5);
  assert.equal(nextEngagementPrompt({ moodDue: true, questionDue: true, attempt: null }), "mood");
  assert.equal(nextEngagementPrompt({ moodDue: false, questionDue: true, attempt: null }), "question");
  assert.equal(nextEngagementPrompt({ moodDue: false, questionDue: false, attempt: null }), null);
  assert.equal(nextEngagementPrompt({ moodDue: false, questionDue: true, attempt: {} }), null);
  assert.equal(starProgress(90).remaining, 10);
  assert.equal(starProgress(100).stars, 1);
  assert.equal(starProgress(100).goal, 200);
  assert.equal(starProgress(230).stars, 2);
  assert.equal(starProgress(230).progress, 30);
});
