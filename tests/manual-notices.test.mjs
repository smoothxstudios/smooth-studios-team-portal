import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { manualNoticesRoute } from "../team-api/manual-notices.mjs";
import { tokenHash } from "../lib/team-auth.mjs";

const now = Date.parse("2026-10-17T12:00:00Z");
mock.timers.enable({ apis: ["Date"], now });
test.beforeEach(() => mock.timers.setTime(now));
test.after(() => mock.timers.reset());
const folder = new URL("../team-api/migrations/", import.meta.url);
const migrations = readdirSync(folder).filter(name => name.endsWith(".sql")).sort().map(name => readFileSync(new URL(name, folder), "utf8"));
class D1 {
  constructor() { this.sqlite = new DatabaseSync(":memory:"); migrations.forEach(sql => this.sqlite.exec(sql)); }
  prepare(sql) {
    let args = []; const db = this.sqlite;
    return { bind(...values) { args = values; return this; },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      runSync() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; },
      async run() { return this.runSync(); } };
  }
  async batch(statements) {
    this.beforeBatch?.(); this.beforeBatch = null;
    this.sqlite.exec("BEGIN");
    try { const results = statements.map(statement => statement.runSync()); this.sqlite.exec("COMMIT"); return results; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}
function fixture(t) {
  const DB = new D1(), pending = [], env = { DB };
  t.after(async () => { await Promise.all(pending); DB.sqlite.close(); });
  const call = async (user, path, data, method = data === undefined ? "GET" : "POST") => {
    const request = new Request(`https://api.example.invalid${path}`, { method,
      ...(data === undefined ? {} : { body: JSON.stringify(data), headers: { "content-type": "application/json" } }) });
    try { return { status: 200, data: await manualNoticesRoute({ request, env, user,
      body: async value => value.json(), fail: (status, message) => { throw Object.assign(new Error(message), { status }); },
      ctx: { waitUntil: promise => pending.push(promise) } }) }; }
    catch (error) { if (!error.status) throw error; return { status: error.status, data: { error: error.message } }; }
  };
  return { DB, env, call, count: table => DB.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count };
}
const notice = (values = {}) => ({ id: crypto.randomUUID(), recipientIds: ["jordyn"], title: "Synthetic reminder",
  body: "Please review your dashboard.", target: values.context ? "scheduling" : "alerts", ...values });
const assignment = { id: "a0000000-0000-4000-8000-000000000001", employeeId: "jordyn", appointmentId: null,
  title: "Synthetic preparation task", instructions: "PRIVATE INSTRUCTIONS", status: "pending",
  start: "2026-10-20T15:00:00Z", end: "2026-10-20T16:00:00Z", createdAt: "2026-10-17T10:00:00Z" };
const addAssignment = (f, values = {}) => {
  const item = { ...assignment, ...values };
  f.DB.sqlite.prepare("INSERT INTO team_assignments(id,employee_id,data) VALUES(?,?,?)").run(item.id, item.employeeId, JSON.stringify(item));
  return item;
};

test("only Smooth can send messages, send assignment reminders, or view sent history", async t => {
  const f = fixture(t); addAssignment(f);
  for (const user of [null, "jordyn", "rayne", "sync"]) {
    assert.equal((await f.call(user, "/notifications", notice())).status, 403);
    assert.equal((await f.call(user, `/assignments/${assignment.id}/remind`, { id: crypto.randomUUID() })).status, 403);
    assert.equal((await f.call(user, "/notifications/sent")).status, 403);
  }
  assert.equal(f.count("manual_notices"), 0); assert.equal(f.count("team_inbox"), 0);
});

test("one owner notice creates private recipient inbox records and safe payloads without claiming provider delivery", async t => {
  const f = fixture(t), input = notice({ recipientIds: ["rayne", "jordyn"], title: "Hello\nteam", body: "Review\u202E settings.", target: "settings" });
  const result = await f.call("owner", "/notifications", input);
  assert.equal(result.status, 200); assert.equal(result.data.sent, true); assert.equal(result.data.recipientCount, 2);
  assert.match(result.data.notification, /queued for enabled devices/);
  assert.equal(f.count("manual_notices"), 1); assert.equal(f.count("team_inbox"), 2);
  const inbox = f.DB.sqlite.prepare("SELECT * FROM team_inbox ORDER BY user_id").all();
  assert.deepEqual(inbox.map(item => item.user_id), ["jordyn", "rayne"]);
  assert.ok(inbox.every(item => item.kind === "notice" && item.person_id === "owner" && item.target === "settings"));
  assert.equal(inbox[0].title, "Hello team"); assert.equal(inbox[0].body, "Review settings.");
  const payload = JSON.parse(f.DB.sqlite.prepare("SELECT payload FROM team_notification_events LIMIT 1").get().payload);
  assert.deepEqual(payload, { title: "Hello team", body: "Review settings.", target: "settings", personId: "owner" });
});

test("client retries stay idempotent after delivery cleanup and recipient deletion tombstones", async t => {
  const f = fixture(t), input = notice({ recipientIds: ["rayne", "jordyn"] });
  const first = await f.call("owner", "/notifications", input);
  const repeated = await Promise.all([f.call("owner", "/notifications", input), f.call("owner", "/notifications", { ...input, recipientIds: ["jordyn", "rayne"] })]);
  assert.ok(repeated.every(result => result.status === 200));
  assert.equal(f.count("team_notification_events"), 2); assert.equal(f.count("team_inbox"), 2);
  f.DB.sqlite.exec("DELETE FROM team_notification_events; UPDATE team_inbox SET deleted_at=1, read_at=1;");
  const after = await f.call("owner", "/notifications", input);
  assert.deepEqual(after.data, first.data);
  assert.equal(f.count("team_notification_events"), 0);
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) AS count FROM team_inbox WHERE deleted_at=1").get().count, 2);
  assert.equal((await f.call("owner", "/notifications", { ...input, body: "Different message" })).status, 409);
  assert.equal(f.count("manual_notices"), 1);
});

test("concurrent matching request IDs create one notice and one push event per recipient", async t => {
  const f = fixture(t), input = notice();
  const results = await Promise.all([f.call("owner", "/notifications", input), f.call("owner", "/notifications", input)]);
  assert.deepEqual(results.map(result => result.status), [200, 200]);
  assert.equal(f.count("manual_notices"), 1); assert.equal(f.count("team_notification_events"), 1); assert.equal(f.count("team_inbox"), 1);
});

test("recipients, titles, bodies, IDs and destinations are validated before queueing", async t => {
  const f = fixture(t);
  for (const values of [{ id: "bad/id" }, { recipientIds: [] }, { recipientIds: ["owner"] }, { recipientIds: ["unknown"] },
    { recipientIds: ["jordyn", "jordyn"] }, { recipientIds: ["jordyn", null] }, { title: "" }, { title: "x".repeat(81) },
    { body: "\u202E\n" }, { body: "x".repeat(361) }, { target: "https://example.invalid" }, { target: "quiz" }]) {
    assert.equal((await f.call("owner", "/notifications", notice(values))).status, 400);
  }
  assert.equal(f.count("manual_notices"), 0); assert.equal(f.count("team_notification_events"), 0);
});

test("freeform notices enforce the per-recipient five-in-five-minutes limit atomically", async t => {
  const f = fixture(t);
  const results = await Promise.all(Array.from({ length: 6 }, () => f.call("owner", "/notifications", notice())));
  assert.equal(results.filter(result => result.status === 200).length, 5);
  assert.equal(results.filter(result => result.status === 429).length, 1);
  assert.equal((await f.call("owner", "/notifications", notice({ recipientIds: ["rayne", "jordyn"] }))).status, 429);
  assert.equal((await f.call("owner", "/notifications", notice({ recipientIds: ["rayne"] }))).status, 200);
  mock.timers.setTime(now + 5 * 60_000);
  assert.equal((await f.call("owner", "/notifications", notice())).status, 200);
});

test("assignment reminders use actual pending assignment details and retain an exact assignment destination", async t => {
  const f = fixture(t); addAssignment(f);
  const id = crypto.randomUUID(), result = await f.call("owner", `/assignments/${assignment.id}/remind`, { id });
  assert.equal(result.status, 200); assert.equal(result.data.recipientCount, 1);
  const inbox = f.DB.sqlite.prepare("SELECT * FROM team_inbox").get();
  assert.equal(inbox.user_id, "jordyn"); assert.equal(inbox.target, "scheduling"); assert.equal(inbox.target_id, assignment.id);
  assert.match(inbox.body, /Synthetic preparation task.*Oct 20.*accept or decline/);
  assert.doesNotMatch(inbox.body, /PRIVATE INSTRUCTIONS/);
  assert.equal(inbox.person_id, "owner");
  assert.equal((await f.call("owner", `/assignments/${assignment.id}/remind`, { id: crypto.randomUUID() })).status, 429);
  f.DB.sqlite.prepare("UPDATE team_assignments SET data=? WHERE id=?").run(JSON.stringify({ ...assignment, status: "accepted" }), assignment.id);
  assert.equal((await f.call("owner", `/assignments/${assignment.id}/remind`, { id })).status, 200, "old receipt remains idempotent after acceptance");
  assert.equal(f.count("team_notification_events"), 1);
});

test("reminders reject accepted, declined, cancelled, missing, past and malformed assignments", async t => {
  const f = fixture(t);
  for (const [index, values] of [{ status: "accepted" }, { status: "declined" }, { status: "cancelled" },
    { start: new Date(now).toISOString() }, { end: "invalid" }, { employeeId: "owner" }].entries()) {
    const item = addAssignment(f, { id: `a0000000-0000-4000-8000-00000000000${index + 1}`, ...values });
    assert.equal((await f.call("owner", `/assignments/${item.id}/remind`, { id: crypto.randomUUID() })).status, 409);
  }
  assert.equal((await f.call("owner", `/assignments/${crypto.randomUUID()}/remind`, { id: crypto.randomUUID() })).status, 404);
  assert.equal(f.count("manual_notices"), 0); assert.equal(f.count("team_inbox"), 0);
});

test("an acceptance racing a reminder prevents both the ledger receipt and inbox/push event", async t => {
  const f = fixture(t); addAssignment(f);
  f.DB.beforeBatch = () => f.DB.sqlite.prepare("UPDATE team_assignments SET data=? WHERE id=?").run(JSON.stringify({ ...assignment, status: "accepted" }), assignment.id);
  const result = await f.call("owner", `/assignments/${assignment.id}/remind`, { id: crypto.randomUUID() });
  assert.equal(result.status, 409);
  assert.equal(f.count("manual_notices"), 0); assert.equal(f.count("team_notification_events"), 0); assert.equal(f.count("team_inbox"), 0);
});

test("racing reminders for the same assignment enforce one five-minute receipt", async t => {
  const f = fixture(t); addAssignment(f);
  const results = await Promise.all([f.call("owner", `/assignments/${assignment.id}/remind`, { id: crypto.randomUUID() }),
    f.call("owner", `/assignments/${assignment.id}/remind`, { id: crypto.randomUUID() })]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 429]);
  assert.equal(f.count("team_notification_events"), 1);
  mock.timers.setTime(now + 5 * 60_000);
  assert.equal((await f.call("owner", `/assignments/${assignment.id}/remind`, { id: crypto.randomUUID() })).status, 200);
});

test("sent audit history returns only the latest twenty owner notices without internal delivery tokens", async t => {
  const f = fixture(t);
  for (let index = 0; index < 21; index++) {
    mock.timers.setTime(now + index * 5 * 60_000);
    assert.equal((await f.call("owner", "/notifications", notice({ title: `Notice ${index}` }))).status, 200);
  }
  const history = (await f.call("owner", "/notifications/sent")).data;
  assert.equal(history.notices.length, 20); assert.equal(history.notices[0].title, "Notice 20");
  assert.equal(history.notices.at(-1).title, "Notice 1");
  assert.deepEqual(Object.keys(history.notices[0]).sort(), ["body", "createdAt", "id", "recipientIds", "target", "title"]);
  assert.doesNotMatch(JSON.stringify(history), /operation_token|request_hash/);
});

const rental = { id: "calendar-rental-fixture", title: "Studio A Rental", customer: "Synthetic client",
  start: assignment.start, end: assignment.end, acceptedEmployeeIds: ["jordyn"] };
const rentalContext = (values = {}) => ({ type: "rental", appointmentId: rental.id, start: rental.start, end: rental.end, ...values });
function addRental(f, values = {}) {
  const item = { ...rental, ...values };
  f.DB.sqlite.prepare("UPDATE team_state SET generation='fixture-generation', revision=5 WHERE id=1").run();
  f.DB.sqlite.prepare("INSERT INTO team_appointments(generation,id,data) VALUES(?,?,?)").run("fixture-generation", item.id, JSON.stringify(item));
  return item;
}

test("upcoming rental reminders use confirmed Calendar and matching accepted app staff while keeping independent Calendar acceptance", async t => {
  const f = fixture(t); addRental(f);
  addAssignment(f, { appointmentId: rental.id, status: "cancelled" });
  addAssignment(f, { id: crypto.randomUUID(), employeeId: "rayne", appointmentId: rental.id, status: "accepted" });
  const input = notice({ recipientIds: ["jordyn", "rayne"], target: "scheduling", context: rentalContext() });
  assert.equal((await f.call("owner", "/notifications", input)).status, 200);
  assert.equal(f.count("team_inbox"), 2);
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) AS count FROM team_inbox WHERE user_id='jordyn'").get().count, 1,
    "a cancelled old app offer does not cancel an independent accepted Calendar invitation");
});

test("rental context rejects stale times, missing or non-rental bookings and pending, tentative or stale-time staff", async t => {
  const f = fixture(t); addRental(f, { acceptedEmployeeIds: [], calendarInvitations: [{ employeeId: "jordyn", status: "tentative" }] });
  addAssignment(f, { appointmentId: rental.id, status: "pending" });
  addAssignment(f, { id: crypto.randomUUID(), employeeId: "rayne", appointmentId: rental.id, status: "accepted", start: "2026-10-20T18:00:00Z" });
  for (const input of [notice({ context: rentalContext() }), notice({ recipientIds: ["rayne"], context: rentalContext() }),
    notice({ context: rentalContext({ start: "2026-10-20T14:00:00Z" }) }), notice({ context: rentalContext({ appointmentId: "missing" }) })]) {
    assert.equal((await f.call("owner", "/notifications", input)).status, 409);
  }
  assert.equal((await f.call("owner", "/notifications", notice({ recipientIds: ["unknown"], context: rentalContext() }))).status, 400);
  f.DB.sqlite.prepare("UPDATE team_appointments SET data=?").run(JSON.stringify({ ...rental, title: "Studio Portrait Package" }));
  assert.equal((await f.call("owner", "/notifications", notice({ context: rentalContext() }))).status, 409);
  assert.equal(f.count("manual_notices"), 0); assert.equal(f.count("team_inbox"), 0);
});

test("a rental or staffing change before the transaction prevents both notice and inbox/push writes", async t => {
  for (const change of ["revision", "generation"]) {
    const f = fixture(t); addRental(f);
    f.DB.beforeBatch = () => {
      if (change === "revision") {
        f.DB.sqlite.prepare("UPDATE team_appointments SET data=?").run(JSON.stringify({ ...rental, acceptedEmployeeIds: [] }));
        f.DB.sqlite.prepare("UPDATE team_state SET revision=revision+1 WHERE id=1").run();
      } else f.DB.sqlite.prepare("UPDATE team_state SET generation='new-generation', revision=revision+1 WHERE id=1").run();
    };
    const result = await f.call("owner", "/notifications", notice({ context: rentalContext() }));
    assert.equal(result.status, 409);
    assert.equal(f.count("manual_notices"), 0); assert.equal(f.count("team_notification_events"), 0); assert.equal(f.count("team_inbox"), 0);
  }
});

test("rental retries remain idempotent after the booking is removed, while changed context cannot reuse the same request", async t => {
  const f = fixture(t); addRental(f);
  const input = notice({ context: rentalContext() });
  const first = await f.call("owner", "/notifications", input); assert.equal(first.status, 200);
  f.DB.sqlite.exec("DELETE FROM team_appointments; DELETE FROM team_notification_events; UPDATE team_inbox SET deleted_at=1; UPDATE team_state SET revision=revision+1;");
  assert.deepEqual((await f.call("owner", "/notifications", input)).data, first.data);
  assert.equal(f.count("team_notification_events"), 0);
  assert.equal((await f.call("owner", "/notifications", { ...input, context: rentalContext({ appointmentId: "different-booking" }) })).status, 409);
});

test("context-free request hashes retain the existing receipt format and Availability is a supported destination", async t => {
  const f = fixture(t), input = notice({ target: "availability" });
  assert.equal((await f.call("owner", "/notifications", input)).status, 200);
  const expected = await tokenHash(JSON.stringify({ kind: "notice", recipientIds: input.recipientIds, title: input.title, body: input.body, target: input.target }));
  assert.equal(f.DB.sqlite.prepare("SELECT request_hash FROM manual_notices WHERE id=?").get(input.id).request_hash, expected);
  assert.equal(f.DB.sqlite.prepare("SELECT target FROM team_inbox").get().target, "availability");
});

test("plural studio rental titles remain valid and rental reminders must open Schedule", async t => {
  const f = fixture(t); addRental(f, { title: "Studio B Rentals" });
  assert.equal((await f.call("owner", "/notifications", notice({ target: "settings", context: rentalContext() }))).status, 400);
  assert.equal((await f.call("owner", "/notifications", notice({ context: rentalContext() }))).status, 200);
  assert.equal(f.count("manual_notices"), 1);
});
