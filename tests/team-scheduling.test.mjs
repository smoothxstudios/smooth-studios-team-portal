import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { createHmac } from "node:crypto";
import test, { mock } from "node:test";
import worker from "../team-api/worker.mjs";
import { teamToken, tokenHash, unbase64url } from "../lib/team-auth.mjs";
import { addLocalDays, blockOccurrences, localInstant, assignmentConflicts, hasConflictOverride } from "../lib/team-schedule.mjs";
import { deliverPush, publicPushKey, pushEndpoint, vapidAuthorization, flushAlerts } from "../team-api/push.mjs";

const schema = await readFile(new URL("../team-api/migrations/0000_brief_ravenous.sql", import.meta.url), "utf8");
const seed = await readFile(new URL("../team-api/migrations/0001_initial_state.sql", import.meta.url), "utf8");
const ids = ["owner", "akiva", "jordyn", "rayne", "sync"];
const tokens = Object.fromEntries(await Promise.all(ids.map(async id => [id, await teamToken(`synthetic-test-password-only-${id}`, id)])));
const hashes = Object.fromEntries(await Promise.all(ids.map(async id => [id, await tokenHash(tokens[id])])));
const now = Date.parse("2026-09-09T12:00:00Z");
mock.timers.enable({ apis: ["Date"], now });
test.after(() => mock.timers.reset());

class D1TestDatabase {
  constructor() { this.sqlite = new DatabaseSync(":memory:"); this.sqlite.exec(schema); this.sqlite.exec(seed); }
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
    assert.equal(options.body.length, 0); assert.equal(options.redirect, "error");
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
