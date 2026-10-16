import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test, { mock } from "node:test";
import { base64url, unbase64url } from "../lib/team-auth.mjs";
import { QUIZ_INTERVAL_MS } from "../lib/team-engagement.mjs";
import { encryptPush, subscriptionKeys } from "../team-api/push-encryption.mjs";
import { flushAlerts } from "../team-api/push.mjs";
import { sendQuizReminders } from "../team-api/quiz-notifications.mjs";
import worker from "../team-api/worker.mjs";
import { fixture, device, answerCurrent } from "./helpers/notification-fixture.mjs";
const now = Date.parse("2026-10-16T18:00:00Z");
mock.timers.enable({ apis: ["Date"], now });
test.beforeEach(() => mock.timers.setTime(now));
test.after(() => mock.timers.reset());

// Public, fixed RFC 8291 section 5 vector, not real subscription credentials.
test("Web Push encryption matches the published RFC 8291 vector exactly", async () => {
  const senderPublic = unbase64url("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
  const jwk = { kty: "EC", crv: "P-256", x: base64url(senderPublic.slice(1, 33)), y: base64url(senderPublic.slice(33)), d: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw" };
  const sender = {
    privateKey: await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]),
    publicKey: await crypto.subtle.importKey("raw", senderPublic, { name: "ECDH", namedCurve: "P-256" }, true, []),
  };
  const body = await encryptPush({ p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" },
    new TextEncoder().encode("When I grow up, I want to be a watermelon"), { sender, salt: unbase64url("DGv6ra1nlYgDCS1FRnbzlw") });
  assert.equal(base64url(body), "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
  await assert.rejects(subscriptionKeys({ p256dh: base64url(new Uint8Array(65)), auth: "BTBZMqHH6r4Tts7J_aSIgg" }));
});

test("existing devices upgrade keys only for their owner and status cannot revive a disabled device", async () => {
  const f = await fixture(), d = device("upgrade");
  assert.equal((await f.call("jordyn", "/push/device", { endpoint: d.endpoint })).status, 200);
  assert.equal((await f.call("rayne", "/push/device/status", d)).data.registered, false);
  assert.equal(f.DB.sqlite.prepare("SELECT p256dh FROM team_devices").get().p256dh, null);
  assert.equal((await f.call("jordyn", "/push/device/status", d)).data.registered, true);
  assert.equal(f.DB.sqlite.prepare("SELECT p256dh FROM team_devices").get().p256dh, d.keys.p256dh);
  assert.equal((await f.call("jordyn", "/push/device", { ...d, keys: { p256dh: "bad", auth: "bad" } })).status, 400);
  await f.call("jordyn", "/push/device", d, "DELETE");
  assert.equal((await f.call("jordyn", "/push/device/status", d)).data.registered, false);
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) n FROM team_devices").get().n, 0);
  f.close();
});

test("a task assignment immediately sends an encrypted assignment alert only to its employee", async t => {
  const f = await fixture(), mine = device("assigned"), other = device("other");
  await f.call("jordyn", "/push/device", mine); await f.call("rayne", "/push/device", other);
  f.DB.sqlite.prepare("UPDATE team_state SET synced_at = ? WHERE id = 1").run(new Date(now).toISOString());
  const sent = [];
  t.mock.method(globalThis, "fetch", async (url, options) => { sent.push(url); assert.deepEqual(mine.decrypt(options.body), { type: "assignment" }); return new Response(null, { status: 201 }); });
  const result = await f.call("owner", "/assignments", { revision: 0, employeeId: "jordyn", startLocal: "2026-10-17T13:00", endLocal: "2026-10-17T14:00", title: "Synthetic task", instructions: "Private instructions" });
  assert.equal(result.status, 200, JSON.stringify(result)); await Promise.all(f.pending);
  assert.deepEqual(sent, [mine.endpoint]);
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) n FROM team_alerts").get().n, 0);
  f.close();
});

test("concurrent flushes claim once and retry only the failed device, at most four attempts", async () => {
  const f = await fixture(), first = device("success"), second = device("retry");
  await f.call("jordyn", "/push/device", first); await f.call("jordyn", "/push/device", second);
  f.DB.sqlite.prepare("INSERT INTO team_alerts(user_id, id, due_at, kind) VALUES ('jordyn', 'retry-test', ?, 'assignment')").run(now);
  const sent = [];
  const provider = async (url, options) => { sent.push(url); assert.equal((url === first.endpoint ? first : second).decrypt(options.body).type, "assignment"); return new Response(null, { status: url === first.endpoint ? 201 : 503 }); };
  await Promise.all([flushAlerts(f.env, provider), flushAlerts(f.env, provider)]);
  assert.equal(sent.filter(url => url === first.endpoint).length, 1);
  assert.equal(sent.filter(url => url === second.endpoint).length, 1);
  for (let attempt = 1; attempt <= 5; attempt++) { mock.timers.setTime(now + attempt * 300_000); await flushAlerts(f.env, provider); }
  assert.equal(sent.filter(url => url === first.endpoint).length, 1);
  assert.equal(sent.filter(url => url === second.endpoint).length, 4);
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) n FROM team_alerts").get().n, 0);
  f.close();
});

test("quiz cron follows two-hour spacing, reserves individual questions offline, deduplicates and stops after three", async () => {
  const f = await fixture(), d = device("quiz"); await f.call("jordyn", "/push/device", d);
  const sent = [], provider = async (url, options) => { assert.equal(url, d.endpoint); assert.deepEqual(d.decrypt(options.body), { type: "quiz" }); sent.push(options); return new Response(null, { status: 201 }); };
  await sendQuizReminders(f.env, provider); // No check-in today: no automatic new day.
  assert.equal(sent.length, 0);
  await answerCurrent(f); // First answer at 2pm, then close the dashboard.
  mock.timers.setTime(now + QUIZ_INTERVAL_MS - 1); await sendQuizReminders(f.env, provider); assert.equal(sent.length, 0);
  mock.timers.setTime(now + QUIZ_INTERVAL_MS);
  await Promise.all([sendQuizReminders(f.env, provider), sendQuizReminders(f.env, provider)]);
  assert.equal(sent.length, 1);
  const next = (await f.call("jordyn")).data;
  assert.equal(next.available, true); assert.equal(next.answeredToday, 1);
  await sendQuizReminders(f.env, provider); assert.equal(sent.length, 1);
  await answerCurrent(f);
  mock.timers.setTime(now + 2 * QUIZ_INTERVAL_MS); await sendQuizReminders(f.env, provider); assert.equal(sent.length, 2);
  await answerCurrent(f);
  mock.timers.setTime(now + 3 * QUIZ_INTERVAL_MS); await sendQuizReminders(f.env, provider); assert.equal(sent.length, 2);
  const end = (await f.call("jordyn")).data;
  assert.equal(end.answeredToday, 3); assert.equal(end.summary.points, 30);
  assert.equal(new Set(end.quiz.map(q => q.question.tier)).size, 3);
  f.close();
});

test("shown questions, disabled/legacy devices, inactive staff and owners do not receive quiz reminders", async () => {
  const f = await fixture(), d = device("seen"); await f.call("jordyn", "/push/device", d);
  const state = (await f.call("jordyn")).data;
  await f.call("jordyn", "/engagement/dismiss", { kind: "question", day: state.day, questionId: state.currentQuestionId });
  await f.call("rayne"); await f.call("rayne", "/push/device", { endpoint: device("legacy").endpoint });
  await f.call("owner", "/push/device", device("owner"));
  await f.call("akiva"); await f.call("akiva", "/push/device", device("inactive"));
  const active = JSON.parse(f.env.TEAM_TOKEN_HASHES); delete active.akiva; f.env.TEAM_TOKEN_HASHES = JSON.stringify(active);
  let sent = 0; await sendQuizReminders(f.env, async () => { sent++; return new Response(null, { status: 201 }); });
  assert.equal(sent, 0);
  f.close();
});

test("reminders expire at Eastern midnight, never continue yesterday's quiz, and use the existing cron", async t => {
  const f = await fixture(), d = device("midnight"); await f.call("jordyn", "/push/device", d);
  mock.timers.setTime(Date.parse("2026-11-01T04:30:00Z")); // Fall-back day, 12:30am EDT.
  await f.call("jordyn");
  let deliveries = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => { deliveries++; assert.ok(Number(options.headers.TTL) > 0); return new Response(null, { status: 201 }); });
  const tasks = []; await worker.scheduled({}, f.env, { waitUntil: p => tasks.push(p) }); await Promise.all(tasks);
  assert.equal(deliveries, 1);
  const reminder = f.DB.sqlite.prepare("SELECT expires_at FROM team_quiz_reminders").get();
  assert.equal(reminder.expires_at, Date.parse("2026-11-02T05:00:00Z")); // 25-hour local day.
  mock.timers.setTime(reminder.expires_at); await sendQuizReminders(f.env);
  assert.equal(deliveries, 1);
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) n FROM team_quiz_offers WHERE day = '2026-11-02'").get().n, 0);
  f.close();
});

test("service worker shows distinct alerts and opens only approved dashboard destinations", async () => {
  const source = await readFile(new URL("../public/team-sw.js", import.meta.url), "utf8");
  const handlers = {}, shown = [], opened = [], scope = "https://dashboard.smoothstudios.co/";
  vm.runInNewContext(source, { URL, self: { addEventListener: (kind, fn) => handlers[kind] = fn,
    registration: { scope, showNotification: async (title, options) => shown.push({ title, ...options }) },
    clients: { matchAll: async () => [], openWindow: async url => opened.push(url) } } });
  for (const type of ["assignment", "quiz", "test", "https://untrusted.invalid"]) {
    let pending; handlers.push({ data: { json: () => ({ type }) }, waitUntil: p => pending = p }); await pending;
    const notification = shown.at(-1);
    handlers.notificationclick({ notification: { ...notification, close() {} }, waitUntil: p => pending = p }); await pending;
  }
  assert.match(shown[0].title, /New assignment/); assert.match(shown[1].title, /Daily Quiz/);
  assert.notEqual(shown[0].tag, shown[1].tag);
  assert.deepEqual(opened, [`${scope}#scheduling`, `${scope}#daily-quiz`, `${scope}#scheduling`, `${scope}#scheduling`]);
});
