import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { calendarQueueStatement, calendarDeliveryLease, deliverCalendarAssignment, flushCalendarAssignments } from "../team-api/calendar-delivery.mjs";

const now = Date.parse("2026-10-17T12:00:00Z");
const assignment = { id: "offer-fixture", appointmentId: "event-fixture", employeeId: "jordyn", status: "pending",
  start: "2026-10-20T15:00:00Z", end: "2026-10-20T16:00:00Z", createdAt: "2026-10-17T10:00:00Z", updatedAt: "2026-10-17T10:00:00Z" };
const config = { calendarId: "studio@example.invalid", employees: [
  { id: "jordyn", email: "jordyn@example.invalid", invitationEmails: ["jordyn@example.invalid", "alias@example.invalid"] },
  { id: "rayne", email: "rayne@example.invalid", invitationEmails: ["rayne@example.invalid"] },
] };
const ownerToken = { email: "studio@example.invalid", accessToken: "synthetic-owner-token" };
const employeeToken = { email: "jordyn@example.invalid", accessToken: "synthetic-employee-token" };
const baseEvent = { id: assignment.appointmentId, iCalUID: "fixture-uid", etag: '"owner-1"', status: "confirmed",
  organizer: { email: config.calendarId, self: true }, start: { dateTime: assignment.start }, end: { dateTime: assignment.end },
  summary: "Synthetic booking", description: "Keep booking details", attendees: [],
  extendedProperties: { private: { unrelated: "keep" }, shared: { booking: "keep" } } };
const clone = value => structuredClone(value);
function fixture({ event = {}, propagate = true, alternateId = false, conflict = null, missingOwnCopy = false } = {}) {
  let current = { ...clone(baseEvent), ...clone(event) }, revision = 1, conflicted = false;
  const calls = [];
  const fetcher = async (value, options = {}) => {
    const url = new URL(value), method = options.method ?? "GET", data = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, method, data, headers: options.headers });
    const own = url.pathname.includes("/calendars/primary/");
    const guest = current.attendees.find(person => ["jordyn@example.invalid", "alias@example.invalid"].includes(person.email));
    const ownCopy = () => ({ ...clone(current), id: alternateId ? "own-copy-fixture" : current.id,
      organizer: { ...current.organizer, self: false }, etag: `"employee-${revision}"`,
      attendees: current.attendees.map(person => ({ ...person, self: person === guest })) });
    if (method === "GET") {
      if (!own) return Response.json(current);
      if (url.pathname.endsWith("/events")) return Response.json({ items: guest && !missingOwnCopy ? [ownCopy()] : [] });
      if (!guest || missingOwnCopy || (alternateId && !url.pathname.endsWith("/own-copy-fixture"))) return new Response(null, { status: 404 });
      return Response.json(ownCopy());
    }
    assert.equal(method, "PATCH");
    if (conflict && !conflicted && !own) {
      conflicted = true; current = conflict(clone(current)); current.etag = '"owner-conflict"';
      return new Response(null, { status: 412 });
    }
    if (own) {
      assert.equal(options.headers["If-Match"], `"employee-${revision}"`);
      assert.equal(data.attendeesOmitted, true);
      assert.equal(data.attendees.length, 1);
      assert.equal(data.attendees[0].email, guest.email);
      if (propagate) guest.responseStatus = data.attendees[0].responseStatus;
    } else {
      assert.equal(options.headers["If-Match"], current.etag);
      if (data.attendees) current.attendees = clone(data.attendees);
      if (data.extendedProperties?.private) {
        for (const [key, entry] of Object.entries(data.extendedProperties.private)) {
          if (entry === null) delete current.extendedProperties.private[key]; else current.extendedProperties.private[key] = entry;
        }
      }
    }
    revision++; current.etag = `"owner-${revision}"`;
    return Response.json(own ? ownCopy() : current);
  };
  const deliver = values => deliverCalendarAssignment({ assignment, config, ownerToken, employeeToken: null, now, fetcher, ...values });
  return { calls, deliver, current: () => current };
}

test("a new app offer sends one native invitation, preserves team guests and private booking metadata, and is idempotent", async () => {
  const f = fixture({ event: { attendees: [{ email: "rayne@example.invalid", responseStatus: "accepted", comment: "Keep" }] } });
  assert.deepEqual(await f.deliver(), { status: "synced", code: "invitation_synced", googleStatus: "needsAction" });
  const patches = f.calls.filter(call => call.method === "PATCH");
  assert.equal(patches.length, 1);
  assert.equal(patches[0].url.searchParams.get("sendUpdates"), "all");
  assert.deepEqual(f.current().attendees[0], { email: "rayne@example.invalid", responseStatus: "accepted", comment: "Keep" });
  assert.equal(f.current().description, baseEvent.description);
  assert.equal(f.current().extendedProperties.private.unrelated, "keep");
  assert.equal(f.current().extendedProperties.shared.booking, "keep");
  assert.deepEqual(JSON.parse(f.current().extendedProperties.private.smoothAppGuest_jordyn), { email: employeeToken.email, assignmentId: assignment.id });
  await f.deliver();
  assert.equal(f.calls.filter(call => call.method === "PATCH").length, 1);
});

test("adding or removing app guests holds for review when it would notify unrelated guests", async () => {
  for (const status of ["pending", "cancelled"]) {
    const f = fixture({ event: { attendees: [{ email: "client@example.invalid", responseStatus: "accepted" },
      ...(status === "cancelled" ? [{ email: employeeToken.email, responseStatus: "needsAction" }] : [])],
      extendedProperties: { private: status === "cancelled" ? { smoothAppGuest_jordyn: JSON.stringify({ email: employeeToken.email, assignmentId: assignment.id }) } : {} } } });
    const result = await f.deliver({ assignment: { ...assignment, status } });
    assert.equal(result.status, "needs_review"); assert.equal(result.code, "guest_notifications_review");
    assert.equal(f.calls.some(call => call.method === "PATCH"), false);
  }
});

test("existing aliases are preserved and never duplicated or claimed as app-owned", async () => {
  const f = fixture({ event: { attendees: [{ email: "alias@example.invalid", responseStatus: "accepted" }] } });
  const result = await f.deliver({ assignment: { ...assignment, status: "accepted" } });
  assert.deepEqual(result, { status: "synced", code: "response_confirmed", googleStatus: "accepted" });
  assert.equal(f.calls.filter(call => call.method === "PATCH").length, 0);
  assert.equal(f.current().extendedProperties.private.smoothAppGuest_jordyn, undefined);
});

test("new invitations prefer a connected verified employee alias instead of creating a canonical-address mismatch", async () => {
  const f = fixture();
  await f.deliver({ employeeToken: { ...employeeToken, email: "alias@example.invalid" } });
  assert.deepEqual(f.current().attendees.map(person => person.email), ["alias@example.invalid"]);
});

test("app acceptance responds on the employee's Calendar copy and requires verified organizer acceptance", async () => {
  const f = fixture();
  const result = await f.deliver({ assignment: { ...assignment, status: "accepted" }, employeeToken });
  assert.deepEqual(result, { status: "synced", code: "response_confirmed", googleStatus: "accepted" });
  const writes = f.calls.filter(call => call.method === "PATCH");
  assert.equal(writes.length, 2);
  assert.equal(writes[0].url.searchParams.get("sendUpdates"), "all");
  assert.ok(writes[1].url.pathname.includes("/calendars/primary/"));
  assert.equal(writes[1].url.searchParams.get("sendUpdates"), "none");
  assert.deepEqual(writes[1].data, { attendeesOmitted: true, attendees: [{ email: employeeToken.email, responseStatus: "accepted" }] });
});

test("missing employee authorization and delayed Google propagation never manufacture an accepted check", async () => {
  const disconnected = fixture();
  assert.deepEqual(await disconnected.deliver({ assignment: { ...assignment, status: "accepted" } }),
    { status: "needs_connection", code: "employee_connection", googleStatus: "needsAction" });
  const delayed = fixture({ propagate: false });
  assert.deepEqual(await delayed.deliver({ assignment: { ...assignment, status: "accepted" }, employeeToken }),
    { status: "retrying", code: "response_propagating", googleStatus: "needsAction" });
});

test("employee event lookup falls back to the matching iCalUID and time, without creating another event", async () => {
  const f = fixture({ alternateId: true });
  const result = await f.deliver({ assignment: { ...assignment, status: "accepted" }, employeeToken });
  assert.equal(result.googleStatus, "accepted");
  const lookup = f.calls.find(call => call.url.searchParams.has("iCalUID"));
  assert.equal(lookup.url.searchParams.get("iCalUID"), baseEvent.iCalUID);
  assert.ok(lookup.url.searchParams.has("timeMin")); assert.ok(lookup.url.searchParams.has("timeMax"));
  assert.ok(f.calls.some(call => call.method === "PATCH" && call.url.pathname.endsWith("/own-copy-fixture")));
  assert.equal(f.calls.some(call => call.method === "POST"), false);
});

test("a connection to a different mapped address requires account review when its Calendar has no invitation", async () => {
  const f = fixture({ event: { attendees: [{ email: "alias@example.invalid", responseStatus: "needsAction" }] }, missingOwnCopy: true });
  assert.deepEqual(await f.deliver({ assignment: { ...assignment, status: "accepted" }, employeeToken }),
    { status: "needs_connection", code: "employee_calendar_address" });
  assert.equal(f.calls.some(call => call.method === "PATCH"), false);
});

test("cancellation removes only an app-owned guest and preserves manually added aliases", async () => {
  const owned = fixture(); await owned.deliver();
  assert.deepEqual(await owned.deliver({ assignment: { ...assignment, status: "cancelled" } }), { status: "synced", code: "invitation_removed" });
  assert.equal(owned.current().attendees.length, 0);
  assert.equal(owned.current().extendedProperties.private.smoothAppGuest_jordyn, undefined);
  const manual = fixture({ event: { attendees: [{ email: "alias@example.invalid", responseStatus: "accepted" }] } });
  assert.equal((await manual.deliver({ assignment: { ...assignment, status: "cancelled" } })).code, "existing_calendar_guest_preserved");
  assert.equal(manual.current().attendees.length, 1);
  assert.equal(manual.calls.some(call => call.method === "PATCH"), false);
});

test("old cancellations or responses never overwrite a newer active offer for the same person and event", async () => {
  const f = fixture();
  const old = { ...assignment, status: "cancelled" }, latest = { ...assignment, id: "new-offer", createdAt: "2026-10-17T11:00:00Z" };
  assert.equal((await f.deliver({ assignment: old, assignments: [old, latest] })).code, "newer_assignment");
  assert.equal(f.calls.length, 0);
});

test("a manually removed app guest is not resurrected by a later response or retry for that same offer", async () => {
  const f = fixture({ event: { extendedProperties: { private: { smoothAppGuest_jordyn: JSON.stringify({ email: employeeToken.email, assignmentId: assignment.id }) } } } });
  assert.deepEqual(await f.deliver({ assignment: { ...assignment, status: "accepted" }, employeeToken }),
    { status: "needs_review", code: "invitation_missing" });
  assert.equal(f.calls.some(call => call.method === "PATCH"), false);
  const newOffer = { ...assignment, id: "new-explicit-offer", createdAt: "2026-10-17T11:00:00Z" };
  assert.equal((await f.deliver({ assignment: newOffer })).code, "invitation_synced");
});

test("ETag conflicts re-read and merge current attendees instead of overwriting concurrent Calendar edits", async () => {
  const f = fixture({ conflict: event => ({ ...event, attendees: [{ email: "rayne@example.invalid", responseStatus: "tentative" }], description: "New booking edit" }) });
  assert.equal((await f.deliver()).status, "synced");
  assert.equal(f.current().description, "New booking edit");
  assert.deepEqual(f.current().attendees.map(person => person.email), ["rayne@example.invalid", employeeToken.email]);
  assert.equal(f.calls.filter(call => call.method === "PATCH").length, 2);
});

test("incomplete guest lists, non-organizer copies, edited times, past events and custom tasks cannot send invitations", async () => {
  for (const [event, code] of [[{ attendeesOmitted: true }, "complete_guest_list_required"],
    [{ organizer: { email: config.calendarId, self: false } }, "organizer_copy_required"],
    [{ start: { dateTime: "2026-10-20T18:00:00Z" } }, "time_changed"], [{ status: "cancelled" }, "event_removed"]]) {
    const f = fixture({ event }); assert.equal((await f.deliver()).code, code);
    assert.equal(f.calls.some(call => call.method === "PATCH"), false);
  }
  const f = fixture();
  assert.equal((await f.deliver({ now: Date.parse(assignment.start) })).code, "event_started");
  assert.equal((await f.deliver({ assignment: { ...assignment, appointmentId: null } })).code, "assignment_unavailable");
  assert.equal(f.calls.length, 0);
});

test("app decline changes an existing personal RSVP and never creates a declined invitation", async () => {
  const absent = fixture();
  assert.equal((await absent.deliver({ assignment: { ...assignment, status: "declined" }, employeeToken })).code, "no_calendar_invitation");
  assert.equal(absent.calls.some(call => call.method === "PATCH"), false);
  const f = fixture({ event: { attendees: [{ email: employeeToken.email, responseStatus: "needsAction" }] } });
  assert.equal((await f.deliver({ assignment: { ...assignment, status: "declined" }, employeeToken })).googleStatus, "declined");
});

test("missing connections and superseded queue versions do not perform Google mutations", async () => {
  const f = fixture();
  assert.equal((await f.deliver({ ownerToken: null })).code, "owner_connection");
  assert.equal(f.calls.length, 0);
  assert.equal((await f.deliver({ isCurrent: async () => false })).code, "assignment_changed");
  assert.equal(f.calls.some(call => call.method === "PATCH"), false);
});

class TestDatabase {
  constructor(sql) { this.sqlite = new DatabaseSync(":memory:"); this.sqlite.exec(sql); }
  prepare(sql) {
    let args = []; const sqlite = this.sqlite;
    return { bind(...values) { args = values; return this; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      async run() { const result = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } }; } };
  }
}
test("queue writes obey the assignment transaction guard and a newer mutation resets the durable delivery version", async () => {
  const migration = await readFile(new URL("../team-api/migrations/0022_calendar_assignment_outbox.sql", import.meta.url), "utf8");
  const db = new TestDatabase(`CREATE TABLE team_state(id INTEGER PRIMARY KEY, mutation TEXT); INSERT INTO team_state VALUES(1,'current');
    CREATE TABLE team_assignments(id TEXT PRIMARY KEY, employee_id TEXT, data TEXT); ${migration}`);
  await db.prepare("INSERT INTO team_assignments VALUES(?,?,?)").bind(assignment.id, assignment.employeeId, JSON.stringify(assignment)).run();
  assert.equal((await calendarQueueStatement(db, assignment, "stale").run()).meta.changes, 0);
  await calendarQueueStatement(db, assignment, "current").run();
  const first = await db.prepare("SELECT * FROM calendar_assignment_outbox").first();
  await db.prepare("UPDATE calendar_assignment_outbox SET status='retrying', attempts=4, lease_until=9999999999999").run();
  await calendarQueueStatement(db, assignment, "current").run();
  const next = await db.prepare("SELECT * FROM calendar_assignment_outbox").first();
  assert.notEqual(next.version, first.version); assert.equal(next.status, "pending");
  assert.equal(next.attempts, 0); assert.equal(next.lease_until, 0);
  assert.equal((await db.prepare("UPDATE calendar_assignment_outbox SET status='synced' WHERE version=?").bind(first.version).run()).meta.changes, 0);
});

test("an absent optional Calendar setup does not reject a bounded flush or call Google", async () => {
  const migration = await readFile(new URL("../team-api/migrations/0022_calendar_assignment_outbox.sql", import.meta.url), "utf8");
  const db = new TestDatabase(`CREATE TABLE team_state(id INTEGER PRIMARY KEY, mutation TEXT); INSERT INTO team_state VALUES(1,'current');
    CREATE TABLE team_assignments(id TEXT PRIMARY KEY, employee_id TEXT, data TEXT);
    CREATE TABLE calendar_sync_config(id INTEGER PRIMARY KEY, data TEXT); ${migration}`);
  for (let i = 0; i < 4; i++) {
    const item = { ...assignment, id: `offer-${i}` };
    await db.prepare("INSERT INTO team_assignments VALUES(?,?,?)").bind(item.id, item.employeeId, JSON.stringify(item)).run();
    await calendarQueueStatement(db, item, "current").run();
  }
  const report = await flushCalendarAssignments({ DB: db }, { fetcher: async () => assert.fail("Missing setup must not call Google") });
  assert.equal(report.processed, 3); assert.equal(report.needsConnection, 3);
  const rest = await db.prepare("SELECT COUNT(*) count FROM calendar_assignment_outbox WHERE status='pending'").first();
  assert.equal(rest.count, 1);
});

test("an expired or reclaimed delivery lease cannot write or acknowledge another processor's same-version job", async () => {
  const migration = await readFile(new URL("../team-api/migrations/0022_calendar_assignment_outbox.sql", import.meta.url), "utf8");
  const db = new TestDatabase(`CREATE TABLE team_state(id INTEGER PRIMARY KEY, mutation TEXT); INSERT INTO team_state VALUES(1,'current');
    CREATE TABLE team_assignments(id TEXT PRIMARY KEY, employee_id TEXT, data TEXT); ${migration}`);
  await db.prepare("INSERT INTO team_assignments VALUES(?,?,?)").bind(assignment.id, assignment.employeeId, JSON.stringify(assignment)).run();
  await calendarQueueStatement(db, assignment, "current").run();
  const row = await db.prepare("SELECT * FROM calendar_assignment_outbox").first();
  const oldUntil = 1000, freshUntil = 5000;
  await db.prepare("UPDATE calendar_assignment_outbox SET lease_until=?").bind(oldUntil).run();
  const old = calendarDeliveryLease(db, row, oldUntil);
  assert.equal(await old.current(900), true);
  assert.equal(await old.current(1000), false);
  assert.equal((await old.acknowledge({ status: "synced", code: "invitation_synced" }, 1001)).meta.changes, 0);
  await db.prepare("UPDATE calendar_assignment_outbox SET lease_until=?").bind(freshUntil).run();
  const fresh = calendarDeliveryLease(db, row, freshUntil);
  assert.equal(await old.current(1100), false);
  assert.equal(await fresh.current(1100), true);
  assert.equal((await old.acknowledge({ status: "retrying", code: "google_unavailable" }, 1100)).meta.changes, 0);
  assert.equal((await fresh.acknowledge({ status: "synced", code: "response_confirmed", googleStatus: "accepted" }, 1100)).meta.changes, 1);
  assert.deepEqual(JSON.parse((await db.prepare("SELECT result FROM calendar_assignment_outbox").first()).result), { code: "response_confirmed", googleStatus: "accepted" });
});
