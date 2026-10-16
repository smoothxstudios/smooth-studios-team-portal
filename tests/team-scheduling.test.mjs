import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { createHmac } from "node:crypto";
import test, { mock } from "node:test";
import worker from "../team-api/worker.mjs";
import { teamToken, tokenHash, unbase64url } from "../lib/team-auth.mjs";
import { TEAM, addLocalDays, blockOccurrences, localInstant, assignmentConflicts, hasConflictOverride, workPreferenceMatch } from "../lib/team-schedule.mjs";
import { deliverPush, publicPushKey, pushEndpoint, vapidAuthorization, flushAlerts } from "../team-api/push.mjs";

const schema = await readFile(new URL("../team-api/migrations/0000_brief_ravenous.sql", import.meta.url), "utf8");
const seed = await readFile(new URL("../team-api/migrations/0001_initial_state.sql", import.meta.url), "utf8");
const questionsSchema = await readFile(new URL("../team-api/migrations/0002_guideline_questions.sql", import.meta.url), "utf8");
const preferencesSchema = await readFile(new URL("../team-api/migrations/0003_work_preferences.sql", import.meta.url), "utf8");
const notificationSchema = await readFile(new URL("../team-api/migrations/0009_push_notifications.sql", import.meta.url), "utf8");
const ids = [...TEAM.map(person => person.id), "sync"];
const tokens = Object.fromEntries(await Promise.all(ids.map(async id => [id, await teamToken(`synthetic-test-password-only-${id}`, id)])));
const hashes = Object.fromEntries(await Promise.all(ids.map(async id => [id, await tokenHash(tokens[id])])));
const now = Date.parse("2026-09-09T12:00:00Z");
mock.timers.enable({ apis: ["Date"], now });
test.after(() => mock.timers.reset());

class D1TestDatabase {
  constructor() { this.sqlite = new DatabaseSync(":memory:"); this.sqlite.exec(schema); this.sqlite.exec(seed); this.sqlite.exec(questionsSchema); this.sqlite.exec(preferencesSchema); this.sqlite.exec(notificationSchema); }
  prepare(sql) {
    const sqlite = this.sqlite;
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      runSync() { const r = sqlite.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
      async run() { return this.runSync(); },
    };
  }
  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try { const results = statements.map(s => s.runSync()); this.sqlite.exec("COMMIT"); return results; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}
function fixture() {
  const DB = new D1TestDatabase();
  const env = { DB, TEAM_TOKEN_HASHES: JSON.stringify(hashes) };
  const pending = [];
  const call = async (user, path, data, method = data === undefined ? "GET" : "POST", extraHeaders = {}) => {
    const response = await worker.fetch(new Request(`https://api.example.invalid${path}`, {
      method, headers: { ...(user ? { authorization: `Bearer ${tokens[user] ?? user}` } : {}),
        "content-type": "application/json", origin: "https://smoothxstudios.github.io", ...extraHeaders },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    }), env, { waitUntil: p => pending.push(p) });
    return { status: response.status, data: await response.json() };
  };
  const snapshot = async user => (await call(user ?? "owner", "/schedule")).data;
  const importCalendar = async (appointments = [rental], generation = crypto.randomUUID()) => {
    assert.equal((await call("sync", "/sync/import", { generation, appointments })).status, 200);
    return call("sync", "/sync/commit", { generation, count: appointments.length });
  };
  return { DB, env, call, snapshot, importCalendar, pending };
}
const rental = { id: "rental-fixture", title: "Studio Rental", customer: "Synthetic Customer", priceCents: 10000,
  start: "2026-10-05T13:00:00Z", end: "2026-10-05T14:00:00Z", acceptedEmployeeIds: [] };
const block = { userId: "jordyn", reason: "Class", startLocal: "2026-10-05T09:00", endLocal: "2026-10-05T10:00", repeatUntil: "2026-12-15" };
async function offer(f, employeeId = "jordyn") {
  const result = await f.call("owner", "/assignments", { revision: (await f.snapshot()).revision,
    employeeId, appointmentId: rental.id, instructions: "Synthetic preparation instructions" });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return (await f.snapshot()).assignments.at(-1);
}

test("purpose-separated client token matches Node HMAC without disclosing password", async () => {
  const password = "fixture-high-entropy-password";
  assert.equal(await teamToken(password, "jordyn"), createHmac("sha256", password).update("smooth-studios-team-portal:team-api:v1:jordyn").digest("base64url"));
  assert.notEqual(await teamToken(password, "owner"), await teamToken(password, "sync"));
});
test("Eastern recurring classes preserve local time across fall DST", () => {
  const values = blockOccurrences(block, "2026-10-01T00:00Z", "2026-12-01T00:00Z");
  assert.equal(values[0].start, "2026-10-05T13:00:00.000Z");
  assert.equal(values.find(v => v.start.startsWith("2026-11-02")).start, "2026-11-02T14:00:00.000Z");
  assert.throws(() => localInstant("2027-03-14T02:30"), /daylight-saving/);
  assert.throws(() => localInstant("2026-02-30T09:00"), /valid/);
  assert.equal(addLocalDays("2026-12-31T10:30", 1), "2027-01-01T10:30");
});
test("overlap checks allow back-to-back work and detect recurring blocks", () => {
  const period = { start: "2026-11-02T14:30:00Z", end: "2026-11-02T15:30:00Z" };
  assert.equal(assignmentConflicts("jordyn", period, [block], [], []).length, 1);
  assert.equal(assignmentConflicts("jordyn", { ...period, start: "2026-11-02T15:00:00Z" }, [block], [], []).length, 0);
});
test("API requires authentication, checks origin, and separates sync authority", async () => {
  const f = fixture();
  assert.equal((await f.call(null, "/schedule")).status, 401);
  assert.equal((await f.call("bad-key", "/schedule")).status, 401);
  assert.equal((await f.call("owner", "/schedule", undefined, "GET", { origin: "https://untrusted.invalid" })).status, 403);
  assert.equal((await f.call("jordyn", "/sync/accepted")).status, 403);
  assert.equal((await f.call("sync", "/schedule")).status, 403);
  assert.equal((await f.call("rayne", "/assignments", {})).status, 403);
  assert.equal((await f.call(null, "/health")).data.ready, true);
});

test("shared login verifies identity without exposing dashboard data and restricts the team list", async () => {
  const f = fixture();
  assert.equal((await f.call(null, "/identity")).status, 401);
  assert.equal((await f.call("bad-key", "/identity")).status, 401);
  assert.equal((await f.call("sync", "/identity")).status, 403);
  for (const person of TEAM) {
    const result = await f.call(person.id, "/identity");
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { user: { id: person.id, username: person.id === "owner" ? "smooth" : person.id,
      name: person.name, role: person.id === "owner" ? "owner" : "member" } });
  }
  assert.equal((await f.call("amia", "/identity/team")).status, 403);
  assert.equal((await f.call("sync", "/identity/team")).status, 403);
  assert.equal((await f.call("owner", "/identity/team")).data.members.length, TEAM.length);
  const reduced = { ...hashes }; delete reduced.amia;
  f.env.TEAM_TOKEN_HASHES = JSON.stringify(reduced);
  assert.equal((await f.call("amia", "/identity")).status, 401);
  assert.equal((await f.call("owner", "/identity/team")).data.members.some(p => p.id === "amia"), false);
  const response = await worker.fetch(new Request("https://api.example.invalid/identity", {
    headers: { authorization: `Bearer ${tokens.owner}` },
  }), f.env, { waitUntil() {} });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("custom dashboard origin supports preflight and authenticated scheduling without opening other origins", async () => {
  const f = fixture();
  const origin = "https://dashboard.smoothstudios.co";
  const preflight = await worker.fetch(new Request("https://api.example.invalid/schedule", { method: "OPTIONS", headers: { origin } }), f.env, { waitUntil() {} });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
  assert.match(preflight.headers.get("access-control-allow-headers"), /Authorization/);
  assert.match(preflight.headers.get("access-control-allow-methods"), /PATCH/);
  assert.equal((await f.call("jordyn", "/schedule", undefined, "GET", { origin })).status, 200);
  assert.equal((await f.call(null, "/schedule", undefined, "GET", { origin })).status, 401);
  assert.equal((await f.call("owner", "/schedule", undefined, "GET", { origin: "https://dashboard.smoothstudios.co.untrusted.invalid" })).status, 403);
});

test("guideline questions are shared with the owner without exposing another employee's queue", async () => {
  const f = fixture();
  assert.equal((await f.call(null, "/guidelines/questions")).status, 401);
  assert.equal((await f.call("sync", "/guidelines/questions")).status, 403);
  const first = await f.call("jordyn", "/guidelines/questions", { question: "Where are the spare batteries?", askedBy: "owner" });
  assert.equal(first.status, 200);
  await f.call("amia", "/guidelines/questions", { question: "Where should we store client umbrellas?" });
  const own = await f.call("jordyn", "/guidelines/questions");
  assert.equal(own.data.questions.length, 1);
  assert.equal(own.data.questions[0].askedBy, "jordyn");
  assert.equal((await f.call("owner", "/guidelines/questions")).data.questions.length, 2);
  assert.equal((await f.call("rayne", `/guidelines/questions/${first.data.id}`, { status: "answered" }, "PATCH")).status, 403);
  assert.equal((await f.call("owner", `/guidelines/questions/${first.data.id}`, { status: "answered" }, "PATCH")).status, 200);
  assert.equal((await f.call("jordyn", "/guidelines/questions")).data.questions[0].status, "answered");
});

test("question submissions validate length, deduplicate retries and limit open requests", async () => {
  const f = fixture();
  assert.equal((await f.call("owner", "/guidelines/questions", { question: "short" })).status, 400);
  assert.equal((await f.call("owner", "/guidelines/questions", { question: "x".repeat(301) })).status, 400);
  const a = await f.call("terrill", "/guidelines/questions", { question: "Where is the loading area?" });
  const retry = await f.call("terrill", "/guidelines/questions", { question: "WHERE IS THE LOADING AREA" });
  assert.equal(retry.data.id, a.data.id);
  for (let i = 1; i < 60; i++) assert.equal((await f.call("terrill", "/guidelines/questions", { question: `Synthetic question number ${i}?` })).status, 200);
  assert.equal((await f.call("terrill", "/guidelines/questions", { question: "One more unanswered question?" })).status, 400);
  assert.equal((await f.call("owner", `/guidelines/questions/${a.data.id}`, { status: "answered" }, "PATCH")).status, 200);
  assert.equal((await f.call("terrill", "/guidelines/questions", { question: "One more unanswered question?" })).status, 200);
});
test("employee cannot create another employee's block or read their class reason", async () => {
  const f = fixture();
  assert.equal((await f.call("jordyn", "/blocks", { ...block, userId: "rayne", revision: 0 })).status, 200);
  assert.equal((await f.snapshot()).blocks[0].userId, "jordyn");
  assert.equal((await f.snapshot("rayne")).blocks.length, 0);
  const id = (await f.snapshot()).blocks[0].id;
  assert.equal((await f.call("rayne", `/blocks/${id}`, { revision: 1 }, "DELETE")).status, 404);
  assert.equal((await f.call("jordyn", `/blocks/${id}`, { revision: 1 }, "DELETE")).status, 200);
});
test("invalid dates, past blocks, long repeats and DST gaps are rejected", async () => {
  const f = fixture();
  for (const values of [
    { startLocal: "2026-10-05T09:00", endLocal: "2026-10-05T08:00" },
    { startLocal: "2026-02-30T09:00" }, { repeatUntil: "2028-01-01" },
    { startLocal: "2027-03-14T02:30", endLocal: "2027-03-14T03:30" },
    { startLocal: "2026-03-04T09:00" }, { repeatUntil: "2026-99-01" },
  ]) assert.equal((await f.call("jordyn", "/blocks", { ...block, revision: 0, ...values })).status, 400);
  assert.equal((await f.snapshot()).blocks.length, 0);
});
test("stale and racing writes cannot partially save or double-book a person", async () => {
  const f = fixture(); await f.importCalendar();
  const revision = (await f.snapshot()).revision;
  const data = { revision, employeeId: "jordyn", appointmentId: rental.id, instructions: "" };
  const results = await Promise.all([f.call("owner", "/assignments", data), f.call("owner", "/assignments", data)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal((await f.snapshot()).assignments.length, 1);
  assert.equal((await f.call("owner", "/blocks", { ...block, revision })).status, 409);
  assert.equal((await f.snapshot()).blocks.length, 0);
});
test("ongoing classes can start in the past, but expired series and past one-time blocks are rejected", async () => {
  const f = fixture();
  const ongoing = { ...block, startLocal: "2026-09-07T12:00", endLocal: "2026-09-07T13:00", repeatUntil: "2026-12-16" };
  assert.equal((await f.call("owner", "/blocks", { ...ongoing, revision: 0 })).status, 200);
  const saved = (await f.snapshot()).blocks[0];
  assert.equal(saved.startLocal, ongoing.startLocal);
  assert.equal(blockOccurrences(saved, "2026-09-14T00:00Z", "2026-09-15T00:00Z")[0].start, "2026-09-14T16:00:00.000Z");
  assert.equal((await f.call("jordyn", "/blocks", { ...ongoing, repeatUntil: null, revision: 1 })).status, 400);
  assert.equal((await f.call("jordyn", "/blocks", { ...ongoing, repeatUntil: "2026-09-08", revision: 1 })).status, 400);
});
test("owner conflict approval permits an offer and employee response without duplicate assignments", async () => {
  const f = fixture(); await f.importCalendar();
  await f.call("jordyn", "/blocks", { ...block, revision: (await f.snapshot()).revision });
  const data = { employeeId: "jordyn", appointmentId: rental.id, overrideConflicts: true };
  assert.equal((await f.call("rayne", "/assignments", { ...data, revision: (await f.snapshot()).revision })).status, 403);
  assert.equal((await f.call("owner", "/assignments", { ...data, revision: (await f.snapshot()).revision })).status, 200);
  const item = (await f.snapshot()).assignments[0];
  assert.equal(item.status, "pending");
  assert.equal(hasConflictOverride(item), true);
  assert.equal((await f.call("sync", "/sync/accepted")).data.assignments.length, 0);
  assert.equal((await f.call("sync", "/sync/accepted")).data.calendarAssignments[0].status, "pending");
  assert.equal((await f.call("owner", "/assignments", { ...data, revision: (await f.snapshot()).revision })).status, 409);
  assert.equal((await f.call("jordyn", `/assignments/${item.id}`, { status: "accepted", revision: (await f.snapshot()).revision })).status, 200);
  assert.equal((await f.call("sync", "/sync/accepted")).data.assignments.length, 1);
});
test("only the owner can approve an existing conflict, and moving the event clears approval", async () => {
  const f = fixture(); await f.importCalendar(); const item = await offer(f);
  await f.call("jordyn", "/blocks", { ...block, revision: (await f.snapshot()).revision });
  assert.equal((await f.call("jordyn", `/assignments/${item.id}`, { overrideConflicts: true, status: "accepted", revision: (await f.snapshot()).revision })).status, 403);
  assert.equal((await f.call("owner", `/assignments/${item.id}`, { overrideConflicts: true, revision: (await f.snapshot()).revision })).status, 200);
  assert.equal((await f.snapshot()).assignments[0].status, "pending");
  assert.equal((await f.call("jordyn", `/assignments/${item.id}`, { status: "accepted", revision: (await f.snapshot()).revision })).status, 200);
  await f.importCalendar([{ ...rental, start: "2026-10-12T13:00:00Z", end: "2026-10-12T14:00:00Z" }]);
  assert.equal((await f.snapshot()).assignments[0].status, "pending");
  assert.equal(hasConflictOverride((await f.snapshot()).assignments[0]), false);
  assert.equal((await f.call("jordyn", `/assignments/${item.id}`, { status: "accepted", revision: (await f.snapshot()).revision })).status, 409);
});
test("blocks and accepted calendar work prevent conflicting offers", async () => {
  const f = fixture(); await f.importCalendar();
  await f.call("jordyn", "/blocks", { ...block, revision: (await f.snapshot()).revision });
  const result = await f.call("owner", "/assignments", { revision: (await f.snapshot()).revision, employeeId: "jordyn", appointmentId: rental.id });
  assert.equal(result.status, 409); assert.match(result.data.error, /Class/);
  await f.importCalendar([{ ...rental, acceptedEmployeeIds: ["akiva"] }]);
  assert.equal((await f.call("owner", "/assignments", { revision: (await f.snapshot()).revision, employeeId: "akiva", appointmentId: rental.id })).status, 409);
});
test("pending rental is private to its employee, and only that person can accept", async () => {
  const f = fixture(); await f.importCalendar(); const item = await offer(f);
  assert.equal((await f.snapshot("rayne")).assignments.length, 0);
  assert.equal((await f.snapshot("rayne")).appointments.length, 0);
  assert.equal((await f.snapshot("jordyn")).appointments.length, 1);
  assert.equal((await f.call("sync", "/sync/accepted")).data.assignments.length, 0);
  const revision = (await f.snapshot()).revision;
  assert.equal((await f.call("rayne", `/assignments/${item.id}`, { revision, status: "accepted" })).status, 404);
  assert.equal((await f.call("owner", `/assignments/${item.id}`, { revision, status: "accepted" })).status, 409);
  assert.equal((await f.call("jordyn", `/assignments/${item.id}`, { revision, status: "accepted" })).status, 200);
  assert.equal((await f.call("sync", "/sync/accepted")).data.assignments[0].employeeId, "jordyn");
});
test("a new class block prevents acceptance but does not silently cancel the offer", async () => {
  const f = fixture(); await f.importCalendar(); const item = await offer(f);
  assert.equal((await f.call("jordyn", "/blocks", { ...block, revision: (await f.snapshot()).revision })).status, 200);
  assert.equal((await f.call("jordyn", `/assignments/${item.id}`, { revision: (await f.snapshot()).revision, status: "accepted" })).status, 409);
  assert.equal((await f.snapshot()).assignments[0].status, "pending");
});
test("custom assignments never enter rental payroll export", async () => {
  const f = fixture(); await f.importCalendar();
  assert.equal((await f.call("owner", "/assignments", { revision: 1, employeeId: "rayne", title: "Studio prep", instructions: "Check lights", startLocal: "2026-10-07T10:00", endLocal: "2026-10-07T11:00" })).status, 200);
  const item = (await f.snapshot()).assignments[0];
  assert.equal((await f.call("rayne", `/assignments/${item.id}`, { revision: 2, status: "accepted" })).status, 200);
  assert.equal((await f.call("sync", "/sync/accepted")).data.assignments.length, 0);
});
test("started offers cannot be accepted or cancelled to rewrite historical earnings", async () => {
  const f = fixture(); await f.importCalendar(); const item = await offer(f);
  mock.timers.setTime(Date.parse(rental.end) + 60_000);
  try {
    const revision = (await f.snapshot()).revision;
    assert.equal((await f.call("jordyn", `/assignments/${item.id}`, { revision, status: "accepted" })).status, 409);
    assert.equal((await f.call("owner", `/assignments/${item.id}`, { revision, status: "cancelled" })).status, 409);
    assert.equal((await f.snapshot()).assignments[0].status, "pending");
  } finally { mock.timers.setTime(now); }
});
test("stale Calendar data stops new offers instead of claiming someone is available", async () => {
  const f = fixture(); await f.importCalendar();
  mock.timers.setTime(now + 3 * 3600_000);
  try {
    const result = await f.call("owner", "/assignments", { revision: 1, appointmentId: rental.id, employeeId: "jordyn" });
    assert.equal(result.status, 409); assert.match(result.data.error, /sync/);
  } finally { mock.timers.setTime(now); }
});
test("changed calendar times require new acceptance and incomplete imports stay invisible", async () => {
  const f = fixture(); await f.importCalendar(); const item = await offer(f);
  await f.call("jordyn", `/assignments/${item.id}`, { revision: (await f.snapshot()).revision, status: "accepted" });
  const updated = { ...rental, start: "2026-10-06T13:00:00Z", end: "2026-10-06T14:00:00Z" };
  await f.call("sync", "/sync/import", { generation: "new-fixture", appointments: [updated] });
  assert.equal((await f.snapshot()).appointments[0].start, "2026-10-05T13:00:00.000Z");
  assert.equal((await f.call("sync", "/sync/commit", { generation: "new-fixture", count: 2 })).status, 409);
  assert.equal((await f.call("sync", "/sync/accepted")).data.assignments.length, 1);
  assert.equal((await f.call("sync", "/sync/commit", { generation: "new-fixture", count: 1 })).status, 200);
  assert.equal((await f.snapshot()).assignments[0].status, "pending");
  assert.equal((await f.call("sync", "/sync/accepted")).data.assignments.length, 0);
});
test("removed calendar appointment cancels offer and prevents accepting it", async () => {
  const f = fixture(); await f.importCalendar(); const item = await offer(f);
  assert.equal((await f.importCalendar([])).status, 200);
  assert.equal((await f.snapshot()).assignments[0].status, "cancelled");
  assert.equal((await f.call("jordyn", `/assignments/${item.id}`, { revision: (await f.snapshot()).revision, status: "accepted" })).status, 409);
});
test("Calendar snapshots strip payments, descriptions and contact information", async () => {
  const f = fixture(); await f.importCalendar([{ ...rental, email: "private@example.invalid", description: "PRIVATE", paidOnlineCents: 10000, acceptedEmployeeIds: ["jordyn", "rayne"] }]);
  const view = await f.snapshot("jordyn");
  assert.deepEqual(view.appointments[0].acceptedEmployeeIds, ["jordyn"]);
  assert.equal(view.appointments[0].email, undefined);
  assert.equal(view.appointments[0].description, undefined);
  assert.equal(view.appointments[0].paidOnlineCents, undefined);
});
test("push endpoints reject SSRF, redirects and unsupported providers", () => {
  for (const value of ["http://fcm.googleapis.com/x", "https://localhost/x", "https://fcm.googleapis.com.attacker.invalid/x", "https://a:f@fcm.googleapis.com/x", "https://fcm.googleapis.com:999/x", "https://127.0.0.1/x"]) assert.throws(() => pushEndpoint(value));
  assert.equal(pushEndpoint("https://web.push.apple.com/fixture"), "https://web.push.apple.com/fixture");
});
test("VAPID signatures verify, with correct audience and an empty private payload", async () => {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", keys.privateKey);
  const endpoint = "https://fcm.googleapis.com/fixture-only";
  const header = await vapidAuthorization(endpoint, jwk);
  const jwt = header.match(/t=([^,]+)/)[1]; const [h, p, sig] = jwt.split(".");
  assert.equal(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, keys.publicKey, unbase64url(sig), new TextEncoder().encode(`${h}.${p}`)), true);
  const payload = JSON.parse(new TextDecoder().decode(unbase64url(p)));
  assert.equal(payload.aud, "https://fcm.googleapis.com");
  assert.equal(payload.exp, Math.floor(now / 1000) + 43200);
  assert.equal(unbase64url(publicPushKey(jwk)).length, 65);
  const result = await deliverPush(endpoint, jwk, async (_url, options) => {
    assert.equal(options.body.length, 0); assert.equal(options.redirect, "manual");
    assert.equal(options.headers.TTL, "86400"); return new Response(null, { status: 201 });
  });
  assert.equal(result.accepted, true);
});
test("push subscriptions cannot transfer silently between profiles", async () => {
  const f = fixture(); f.env.VAPID_JWK = "{}";
  const data = { endpoint: "https://fcm.googleapis.com/fixture-only" };
  assert.equal((await f.call("jordyn", "/push/device", data)).status, 200);
  assert.equal((await f.call("rayne", "/push/device", data)).status, 409);
  await f.call("rayne", "/push/device", data, "DELETE");
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM team_devices").get().n, 1);
  assert.equal((await f.call("jordyn", "/push/device", data, "DELETE")).status, 200);
});
test("push retry queue removes expired subscriptions without leaking endpoint data", async () => {
  const f = fixture();
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  f.env.VAPID_JWK = JSON.stringify(await crypto.subtle.exportKey("jwk", keys.privateKey));
  await f.call("jordyn", "/push/device", { endpoint: "https://fcm.googleapis.com/fixture-only" });
  f.DB.sqlite.prepare("INSERT INTO team_alerts (user_id, id, due_at) VALUES (?, ?, ?)").run("jordyn", "alert-fixture", now);
  await flushAlerts(f.env, async () => new Response(null, { status: 410 }));
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM team_devices").get().n, 0);
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM team_alerts").get().n, 0);
});

test("notification status and tests are restricted to this profile's registered device", async t => {
  const f = fixture();
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  f.env.VAPID_JWK = JSON.stringify(await crypto.subtle.exportKey("jwk", keys.privateKey));
  const own = { endpoint: "https://web.push.apple.com/synthetic-own-device" };
  const second = { endpoint: "https://fcm.googleapis.com/synthetic-other-device" };
  await f.call("jordyn", "/push/device", own);
  await f.call("jordyn", "/push/device", second);
  assert.equal((await f.call("jordyn", "/push/device/status", own)).data.registered, true);
  assert.equal((await f.call("rayne", "/push/device/status", own)).data.registered, false);
  const deliveries = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    deliveries.push(url); assert.equal(options.headers.Urgency, "high");
    return new Response(null, { status: 201 });
  });
  assert.equal((await f.call("rayne", "/push/test", own)).status, 409);
  assert.equal((await f.call("jordyn", "/push/test", {})).status, 400);
  assert.equal(deliveries.length, 0);
  const result = await f.call("jordyn", "/push/test", own);
  assert.equal(result.status, 200);
  assert.equal(result.data.accepted, true);
  assert.equal(result.data.provider, "Apple");
  assert.equal(result.data.status, 201);
  assert.match(result.data.message, /Apple accepted/);
  assert.deepEqual(deliveries, [own.endpoint]);
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM team_alerts").get().n, 0);
});

test("test reports provider rejection, removes expired devices, and preserves unrelated queued alerts", async t => {
  const f = fixture();
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  f.env.VAPID_JWK = JSON.stringify(await crypto.subtle.exportKey("jwk", keys.privateKey));
  const data = { endpoint: "https://web.push.apple.com/synthetic-device" };
  await f.call("jordyn", "/push/device", data);
  f.DB.sqlite.prepare("INSERT INTO team_alerts (user_id, id, due_at) VALUES (?, ?, ?)").run("jordyn", "real-offer", now);
  let code = 403;
  t.mock.method(globalThis, "fetch", async () => new Response("private provider response not exposed", { status: code }));
  const rejected = await f.call("jordyn", "/push/test", data);
  assert.equal(rejected.data.accepted, false);
  assert.match(rejected.data.message, /HTTP 403/);
  assert.doesNotMatch(JSON.stringify(rejected.data), /synthetic-device|private provider response/);
  assert.equal((await f.call("jordyn", "/push/device/status", data)).data.registered, true);
  code = 410;
  const expired = await f.call("jordyn", "/push/test", data);
  assert.equal(expired.data.expired, true);
  assert.match(expired.data.message, /expired/);
  assert.equal((await f.call("jordyn", "/push/device/status", data)).data.registered, false);
  assert.equal(f.DB.sqlite.prepare("SELECT id FROM team_alerts").get().id, "real-offer");
});

test("push test reports network failure and refuses a missing push configuration", async t => {
  const f = fixture();
  assert.equal((await f.call("owner", "/push/test", {})).status, 503);
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  f.env.VAPID_JWK = JSON.stringify(await crypto.subtle.exportKey("jwk", keys.privateKey));
  const data = { endpoint: "https://fcm.googleapis.com/synthetic-device" };
  await f.call("owner", "/push/device", data);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("synthetic private error"); });
  const result = await f.call("owner", "/push/test", data);
  assert.equal(result.status, 502);
  assert.match(result.data.error, /could not be reached/);
  assert.doesNotMatch(result.data.error, /synthetic/);
});

test("assignment warns when employee has no notification devices; sync diagnostics expose only counts", async () => {
  const f = fixture();
  await f.importCalendar();
  const result = await f.call("owner", "/assignments", { revision: (await f.snapshot()).revision,
    employeeId: "jordyn", appointmentId: rental.id });
  assert.equal(result.status, 200);
  assert.match(result.data.notification, /no devices enabled/);
  const diagnostic = await f.call("sync", "/sync/accepted");
  assert.deepEqual(diagnostic.data.pushDiagnostics, { registeredDevices: 0, queuedAlerts: 1, retryingAlerts: 0 });
  assert.equal((await f.call("owner", "/sync/accepted")).status, 403);
});


test("new employees can accept only their own rental assignments", async () => {
  const f = fixture(); await f.importCalendar();
  for (const id of ["dacari", "sorayia", "amia", "terrill"]) {
    const item = await offer(f, id);
    assert.equal((await f.call(id, `/assignments/${item.id}`, { revision: (await f.snapshot()).revision, status: "accepted" })).status, 200);
    const own = await f.snapshot(id);
    assert.equal(own.assignments.length, 1);
    assert.equal(own.assignments[0].employeeId, id);
  }
  assert.equal((await f.snapshot("jordyn")).assignments.length, 0);
});

const workPreference = { userId: "jordyn", startLocal: "2026-10-05T00:00", endLocal: "2026-10-06T00:00", allDay: true, repeatUntil: "2026-12-15", note: "Open to rentals" };
async function prefer(f, user = "jordyn", data = workPreference) {
  return f.call(user, "/work-preferences", { ...data, revision: (await f.snapshot()).revision });
}
test("work preferences are private to their employee and owner, and survive unrelated calendar syncs", async () => {
  const f = fixture();
  assert.equal((await f.call(null, "/work-preferences", {})).status, 401);
  assert.equal((await f.call("sync", "/work-preferences", {})).status, 403);
  assert.equal((await prefer(f, "jordyn", { ...workPreference, userId: "rayne" })).status, 200);
  const saved = (await f.snapshot("jordyn")).workPreferences[0];
  assert.equal(saved.userId, "jordyn");
  assert.equal((await f.snapshot("rayne")).workPreferences.length, 0);
  assert.equal((await f.snapshot()).workPreferences.length, 1);
  assert.equal((await f.snapshot()).availabilityVersion, 1);
  assert.equal((await f.call("rayne", `/work-preferences/${saved.id}`, { ...workPreference, revision: 1 }, "PATCH")).status, 404);
  assert.equal((await f.call("rayne", `/work-preferences/${saved.id}`, { revision: 1 }, "DELETE")).status, 404);
  assert.equal((await f.call("jordyn", `/work-preferences/${saved.id}`, { ...workPreference, userId: "rayne", note: "Prefer afternoons", revision: 1 }, "PATCH")).status, 200);
  await f.importCalendar();
  const updated = (await f.snapshot()).workPreferences[0];
  assert.equal(updated.userId, "jordyn");
  assert.equal(updated.note, "Prefer afternoons");
  assert.equal(updated.createdAt, saved.createdAt);
  assert.equal((await f.call("jordyn", `/work-preferences/${saved.id}`, { revision: (await f.snapshot()).revision }, "DELETE")).status, 200);
  assert.equal((await f.snapshot()).workPreferences.length, 0);
});
test("owner can manage employee preferences; duplicate and racing writes are safe", async () => {
  const f = fixture();
  const data = { ...workPreference, userId: "amia", revision: 0 };
  const results = await Promise.all([f.call("owner", "/work-preferences", data), f.call("owner", "/work-preferences", data)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal((await prefer(f, "owner", data)).status, 409);
  assert.equal((await prefer(f, "owner", { ...data, userId: "owner" })).status, 400);
  const saved = (await f.snapshot()).workPreferences[0];
  assert.equal(saved.userId, "amia");
  assert.equal((await f.call("owner", `/work-preferences/${saved.id}`, { ...workPreference, note: "Updated by Smooth", revision: 0 }, "PATCH")).status, 409);
  assert.equal((await f.snapshot()).workPreferences[0].note, "Open to rentals");
  assert.equal((await f.call("owner", `/work-preferences/${saved.id}`, { revision: 1 }, "DELETE")).status, 200);
});
test("preferred days validate dates, hours, full-day boundaries and series limits", async () => {
  const f = fixture();
  for (const invalid of [
    { startLocal: "2026-02-30T00:00" }, { endLocal: "2026-10-04T00:00" },
    { endLocal: "2026-10-07T00:00" }, { allDay: "yes" },
    { startLocal: "2026-10-05T12:00" }, { repeatUntil: "2028-01-01" },
    { repeatUntil: "2026-02-30" }, { note: "x".repeat(121) },
    { startLocal: "2026-08-03T00:00", endLocal: "2026-08-04T00:00", repeatUntil: null },
    { startLocal: "2027-03-07T02:30", endLocal: "2027-03-07T03:30", repeatUntil: "2027-03-21", allDay: false },
  ]) assert.equal((await prefer(f, "jordyn", { ...workPreference, ...invalid })).status, 400, JSON.stringify(invalid));
  assert.equal((await f.snapshot()).workPreferences.length, 0);
  assert.equal((await prefer(f, "jordyn", { ...workPreference, startLocal: "2026-09-09T00:00", endLocal: "2026-09-10T00:00", repeatUntil: null })).status, 200);
  assert.equal((await prefer(f, "jordyn", { ...workPreference, startLocal: "2026-08-31T00:00", endLocal: "2026-09-01T00:00", repeatUntil: "2026-12-15" })).status, 200);
});
test("full-day weekly preferences preserve local dates through both DST transitions", async () => {
  const f = fixture();
  const fullDay = { ...workPreference, startLocal: "2026-10-25T00:00", endLocal: "2026-10-26T00:00", repeatUntil: "2027-04-01" };
  assert.equal((await prefer(f, "jordyn", fullDay)).status, 200);
  const occurrences = blockOccurrences(fullDay, "2026-11-01T00:00Z", "2027-03-16T00:00Z");
  const fall = occurrences.find(p => p.start.startsWith("2026-11-01"));
  const spring = occurrences.find(p => p.start.startsWith("2027-03-14"));
  assert.equal((Date.parse(fall.end) - Date.parse(fall.start)) / 3600000, 25);
  assert.equal((Date.parse(spring.end) - Date.parse(spring.start)) / 3600000, 23);
});
test("preference matching distinguishes partial windows, joins adjacent windows, and honors gaps", () => {
  const period = { start: "2026-10-05T13:00Z", end: "2026-10-05T15:00Z" };
  const first = { ...workPreference, allDay: false, startLocal: "2026-10-05T09:00", endLocal: "2026-10-05T10:00" };
  const second = { ...first, startLocal: "2026-10-05T10:00", endLocal: "2026-10-05T11:00" };
  assert.equal(workPreferenceMatch("jordyn", period, [workPreference]), "full");
  assert.equal(workPreferenceMatch("rayne", period, [workPreference]), "none");
  assert.equal(workPreferenceMatch("jordyn", period, [first]), "partial");
  assert.equal(workPreferenceMatch("jordyn", period, [first, second]), "full");
  assert.equal(workPreferenceMatch("jordyn", period, [first, { ...second, startLocal: "2026-10-05T10:30" }]), "partial");
  assert.equal(workPreferenceMatch("jordyn", { start: period.end, end: "2026-10-05T16:00Z" }, [second]), "none");
});
test("preferences never create assignments, accrue pay, or override time conflicts", async () => {
  const f = fixture(); await f.importCalendar();
  assert.equal((await prefer(f)).status, 200);
  assert.equal((await f.snapshot()).assignments.length, 0);
  assert.equal((await f.call("sync", "/sync/accepted")).data.assignments.length, 0);
  assert.equal((await f.call("jordyn", "/blocks", { ...block, revision: (await f.snapshot()).revision })).status, 200);
  assert.equal(workPreferenceMatch("jordyn", rental, (await f.snapshot()).workPreferences), "full");
  assert.equal((await f.call("owner", "/assignments", { employeeId: "jordyn", appointmentId: rental.id, revision: (await f.snapshot()).revision })).status, 409);
  assert.equal((await f.snapshot()).blocks.length, 1);
  // No stated preference does not prevent an otherwise valid assignment offer.
  assert.equal((await f.call("owner", "/assignments", { employeeId: "rayne", appointmentId: rental.id, revision: (await f.snapshot()).revision })).status, 200);
});
