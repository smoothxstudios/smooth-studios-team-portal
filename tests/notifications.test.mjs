import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test, { mock } from "node:test";
import { base64url, unbase64url } from "../lib/team-auth.mjs";
import { QUIZ_INTERVAL_MS } from "../lib/team-engagement.mjs";
import { encryptPush, subscriptionKeys } from "../team-api/push-encryption.mjs";
import { deliverPush, flushAlerts } from "../team-api/push.mjs";
import { sendQuizReminders } from "../team-api/quiz-notifications.mjs";
import { notificationTime, notificationDetails, assignmentNotifications } from "../team-api/notification-content.mjs";
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
  t.mock.method(globalThis, "fetch", async (url, options) => { sent.push({ url, payload: mine.decrypt(options.body) }); return new Response(null, { status: 201 }); });
  const result = await f.call("owner", "/assignments", { revision: 0, employeeId: "jordyn", startLocal: "2026-10-17T13:00", endLocal: "2026-10-17T14:00", title: "Synthetic task", instructions: "Private instructions" });
  assert.equal(result.status, 200, JSON.stringify(result)); await Promise.all(f.pending);
  assert.deepEqual(sent.map(item => item.url), [mine.endpoint]);
  assert.equal(sent[0].payload.type, "assignment");
  assert.equal(sent[0].payload.title, "New task assignment");
  assert.equal(sent[0].payload.body, "Synthetic task · Sat, Oct 17 · 1:00 PM–2:00 PM. Tap to accept or decline.");
  assert.doesNotMatch(JSON.stringify(sent), /Private instructions/);
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) n FROM team_notification_events").get().n, 0);
  f.close();
});

test("concurrent flushes claim once and retry only the failed device, with bounded backoff and at most eight attempts", async () => {
  const f = await fixture(), first = device("success"), second = device("retry");
  await f.call("jordyn", "/push/device", first); await f.call("jordyn", "/push/device", second);
  f.DB.sqlite.prepare("INSERT INTO team_alerts(user_id, id, due_at, kind) VALUES ('jordyn', 'retry-test', ?, 'assignment')").run(now);
  const sent = [];
  const provider = async (url, options) => { sent.push(url); assert.equal((url === first.endpoint ? first : second).decrypt(options.body).type, "assignment"); return new Response(null, { status: url === first.endpoint ? 201 : 503 }); };
  await Promise.all([flushAlerts(f.env, provider), flushAlerts(f.env, provider)]);
  assert.equal(sent.filter(url => url === first.endpoint).length, 1);
  assert.equal(sent.filter(url => url === second.endpoint).length, 1);
  for (let attempt = 1; attempt <= 8; attempt++) { mock.timers.setTime(now + attempt * 3600_000); await flushAlerts(f.env, provider); }
  assert.equal(sent.filter(url => url === first.endpoint).length, 1);
  assert.equal(sent.filter(url => url === second.endpoint).length, 8);
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) n FROM team_alerts").get().n, 0);
  f.close();
});

test("quiz cron follows two-hour spacing, reserves individual questions offline, deduplicates and stops after three", async () => {
  const f = await fixture(), d = device("quiz"); await f.call("jordyn", "/push/device", d);
  const sent = [], provider = async (url, options) => { sent.push({ url, payload: d.decrypt(options.body) }); return new Response(null, { status: 201 }); };
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
  assert.ok(sent.every(item => item.url === d.endpoint && item.payload.type === "quiz" && item.payload.title === "Quiz Time"));
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
  assert.match(shown[0].title, /New assignment/); assert.equal(shown[1].title, "Quiz Time");
  assert.notEqual(shown[0].tag, shown[1].tag);
  assert.deepEqual(opened, [`${scope}#scheduling`, `${scope}#daily-quiz`, `${scope}#scheduling`, `${scope}#scheduling`]);

  async function show(payload) { let pending; handlers.push({ data: { json: () => payload }, waitUntil: p => pending = p }); await pending; return shown.at(-1); }
  const accepted = await show({ type: "schedule", id: "response-1", title: "Jordyn accepted a rental", body: "Studio A Rental · Fri, Oct 16 · 3:00 PM–4:00 PM.", url: "https://untrusted.invalid" });
  const declined = await show({ type: "schedule", id: "response-2", title: "Rayne declined a rental", body: "Studio B Rental · Sat, Oct 17 · 3:00 PM–4:00 PM." });
  assert.equal(accepted.title, "Jordyn accepted a rental");
  assert.match(accepted.body, /Studio A Rental/);
  assert.notEqual(accepted.tag, declined.tag);
  assert.equal((await show({ type: "schedule", id: "response-1", title: accepted.title, body: accepted.body })).tag, accepted.tag);
  let pending; handlers.notificationclick({ notification: { ...accepted, close() {} }, waitUntil: p => pending = p }); await pending;
  assert.equal(opened.at(-1), `${scope}#scheduling`);
  assert.equal((await show({ type: "unknown", title: "Untrusted", body: "Untrusted" })).title, "Schedule update");
  assert.equal((await show({ type: "schedule", title: {}, body: "broken" })).title, "Schedule update");
  assert.equal((await show(null)).title, "Schedule update");
  const settings = await show({ type: "schedule", title: "Connect Google Calendar", body: "Connect your account in Settings.", target: "settings" });
  handlers.notificationclick({ notification: { ...settings, close() {} }, waitUntil: p => pending = p }); await pending;
  assert.equal(opened.at(-1), `${scope}#settings`);
  const availability = await show({ type: "schedule", title: "Update your availability", body: "Review your work preferences and blocked times.", target: "availability" });
  handlers.notificationclick({ notification: { ...availability, close() {} }, waitUntil: p => pending = p }); await pending;
  assert.equal(opened.at(-1), `${scope}#availability`);
  const invalidTarget = await show({ type: "schedule", title: "Studio reminder", body: "Check your app.", target: "https://untrusted.invalid" });
  handlers.notificationclick({ notification: { ...invalidTarget, close() {} }, waitUntil: p => pending = p }); await pending;
  assert.equal(opened.at(-1), `${scope}#scheduling`);
});

test("owner notices keep their text compatible with installed service workers and allow only fixed destinations", async () => {
  const d = device("notice-compatibility"), pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const key = await crypto.subtle.exportKey("jwk", pair.privateKey), sent = [];
  const provider = async (_url, options) => { sent.push(d.decrypt(options.body)); return new Response(null, { status: 201 }); };
  for (const target of ["settings", "https://untrusted.invalid"]) await deliverPush(d.endpoint, key, provider, {
    kind: "notice", keys: d.keys, notificationId: "synthetic-owner-notice", details: { title: "Connect your Google Calendar", body: "Open Settings to connect.", target },
  });
  assert.deepEqual(sent[0], { type: "schedule", title: "Connect your Google Calendar", body: "Open Settings to connect.", target: "settings", id: "synthetic-owner-notice" });
  assert.equal(sent[1].type, "schedule"); assert.equal(sent[1].target, undefined);
});

test("two booking responses queue separately and send specific encrypted alerts only to Smooth", async () => {
  const f = await fixture(), owner = device("owner-responses"), unrelated = device("unrelated");
  await f.call("owner", "/push/device", owner); await f.call("akiva", "/push/device", unrelated);
  const vapid = f.env.VAPID_JWK; delete f.env.VAPID_JWK; // Hold automatic deliveries until both responses are queued.
  const appointments = [
    { id: "synthetic-rental-1", title: "Studio A Rental", customer: "PRIVATE CLIENT", start: "2026-10-17T17:00:00Z", end: "2026-10-17T18:00:00Z", priceCents: 10000, acceptedEmployeeIds: [] },
    { id: "synthetic-rental-2", title: "Studio B Rental", customer: "PRIVATE CLIENT", start: "2026-10-18T19:00:00Z", end: "2026-10-18T20:00:00Z", priceCents: 10000, acceptedEmployeeIds: [] },
  ];
  assert.equal((await f.call("sync", "/sync/import", { generation: "test", appointments })).status, 200);
  assert.equal((await f.call("sync", "/sync/commit", { generation: "test", count: 2 })).status, 200);
  const state = () => f.call("owner", "/schedule");
  for (const [index, employeeId, status] of [[0, "jordyn", "accepted"], [1, "rayne", "declined"]]) {
    assert.equal((await f.call("owner", "/assignments", { revision: (await state()).data.revision, employeeId, appointmentId: appointments[index].id, instructions: "PRIVATE INSTRUCTIONS" })).status, 200);
    const latest = (await state()).data, item = latest.assignments.find(item => item.employeeId === employeeId);
    assert.equal((await f.call("akiva", `/assignments/${item.id}`, { revision: latest.revision, status })).status, 404);
    assert.equal((await f.call(employeeId, `/assignments/${item.id}`, { revision: latest.revision - 1, status })).status, 409);
    assert.equal((await f.call(employeeId, `/assignments/${item.id}`, { revision: latest.revision, status })).status, 200);
    assert.equal((await f.call(employeeId, `/assignments/${item.id}`, { revision: (await state()).data.revision, status })).status, 409);
  }
  await Promise.all(f.pending);
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) n FROM team_notification_events WHERE user_id = 'owner'").get().n, 2);
  f.env.VAPID_JWK = vapid;
  const sent = [];
  await Promise.all([flushAlerts(f.env, async (url, options) => { sent.push({ url, options, payload: owner.decrypt(options.body) }); return new Response(null, { status: 201 }); }), flushAlerts(f.env, async (url, options) => { sent.push({ url, options, payload: owner.decrypt(options.body) }); return new Response(null, { status: 201 }); })]);
  assert.equal(sent.length, 2); assert.ok(sent.every(item => item.url === owner.endpoint));
  const accepted = sent.find(item => item.payload.title === "Jordyn accepted a rental");
  const declined = sent.find(item => item.payload.title === "Rayne declined a rental");
  assert.equal(accepted.payload.body, "Studio A Rental · Sat, Oct 17 · 1:00 PM–2:00 PM.");
  assert.equal(declined.payload.body, "Studio B Rental · Sun, Oct 18 · 3:00 PM–4:00 PM. Choose another team member.");
  assert.doesNotMatch(JSON.stringify(sent.map(item => item.payload)), /PRIVATE|10000|instructions|priceCents|customer/i);
  assert.notEqual(accepted.payload.id, declined.payload.id);
  assert.notEqual(accepted.options.headers.Topic, declined.options.headers.Topic);
  assert.ok(sent.every(item => /^[A-Za-z0-9_-]{32}$/.test(item.options.headers.Topic)));
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) n FROM team_notification_events").get().n, 0);
  f.close();
});

test("notification dates use studio time across midnight and DST; content is bounded and excludes unrelated fields", () => {
  assert.equal(notificationTime("2026-10-18T03:00:00Z", "2026-10-18T05:00:00Z"), "Sat, Oct 17, 11:00 PM–Sun, Oct 18, 1:00 AM");
  assert.equal(notificationTime("2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z"), "Sun, Nov 1 · 1:30 AM–1:30 AM");
  assert.equal(notificationTime("2026-12-01T17:00:00Z", "2026-12-01T18:00:00Z"), "Tue, Dec 1 · 12:00 PM–1:00 PM");
  const details = notificationDetails({ title: "\nHello\u202e there", body: "x".repeat(500), url: "private", instructions: "private" });
  assert.deepEqual(details, { title: "Hello there", body: "x".repeat(360) });
  const item = { employeeId: "jordyn", appointmentId: "rental", title: "Studio A Rental", start: "2026-10-17T17:00:00Z", end: "2026-10-17T18:00:00Z" };
  const notices = assignmentNotifications(item, "rescheduled", ["owner", "jordyn"]);
  assert.equal(notices[0].title, "Jordyn’s rental time changed");
  assert.equal(notices[1].title, "Rental time changed");
  assert.match(notices[1].body, /accept the new time/);
});

test("availability push carries its own destination and omits timezone labels", async () => {
  const f = await fixture(), d = device("availability-destination");
  await f.call("owner", "/push/device", d);
  const { blockNotifications } = await import("../team-api/notification-content.mjs");
  const details = blockNotifications({ userId: "amia", startLocal: "2026-10-19T15:00", endLocal: "2026-10-19T18:30" }, false, ["owner"])[0];
  let payload;
  await deliverPush(d.endpoint, JSON.parse(f.env.VAPID_JWK), async (_url, options) => {
    payload = d.decrypt(options.body); return new Response(null, { status: 201 });
  }, { keys: d.keys, kind: "schedule", details });
  assert.equal(payload.target, "availability");
  assert.equal(payload.title, "Amia blocked time");
  assert.equal(payload.body, "Mon, Oct 19 · 3:00 PM–6:30 PM.");
  f.close();
});
