import test from "node:test";
import assert from "node:assert/strict";
import { calendarTimeChange, recoverDurationCancellation, LEGACY_PAST_NOTE } from "../team-api/calendar-time-changes.mjs";
import { assignmentNotifications } from "../team-api/notification-content.mjs";
import { fixture } from "./helpers/notification-fixture.mjs";

const original = { id: "synthetic-duration-offer", appointmentId: "synthetic-rental", employeeId: "akiva", title: "Studio B Rental",
  start: "2026-10-17T17:30:00.000Z", end: "2026-10-17T18:00:00.000Z", status: "accepted", instructions: "Keep the setup",
  createdAt: "2026-10-17T15:00:00.000Z", updatedAt: "2026-10-17T15:10:00.000Z" };
const appointment = { id: original.appointmentId, title: original.title, customer: "Synthetic Customer", start: original.start,
  end: "2026-10-17T18:30:00.000Z", priceCents: 5000, acceptedEmployeeIds: [], calendarInvitations: [{ employeeId: "akiva", status: "accepted" }] };
const cancelled = { ...original, end: appointment.end, status: "cancelled", note: LEGACY_PAST_NOTE, updatedAt: "2026-10-17T21:03:00.000Z" };
const now = Date.parse("2026-10-17T22:00:00.000Z");
function notice(item, event, user, createdAt, sequence) {
  const n = assignmentNotifications(item, event, [user])[0];
  return { id: `notice-${sequence}`, sequence, user_id: user, kind: n.kind, title: n.title, body: n.body,
    target: n.target, target_id: n.targetId, person_id: n.personId, created_at: Date.parse(createdAt), read_at: null, deleted_at: null };
}
const history = () => [notice(original, "offered", "akiva", original.createdAt, 1),
  notice(original, "accepted", "owner", original.updatedAt, 2),
  notice(cancelled, "past", "akiva", cancelled.updatedAt, 3), notice(cancelled, "past", "owner", cancelled.updatedAt, 4)];

test("duration changes keep accepted and pending responses before, during, and after the rental", () => {
  for (const at of ["2026-10-17T16:00:00Z", "2026-10-17T17:45:00Z", "2026-10-17T22:00:00Z"]) {
    for (const status of ["accepted", "pending"]) {
      const result = calendarTimeChange({ ...original, status, conflictOverride: { approvedBy: "owner" } }, appointment, Date.parse(at));
      assert.equal(result.event, "duration"); assert.equal(result.assignment.status, status);
      assert.equal(result.assignment.end, appointment.end); assert.equal(result.assignment.id, original.id);
      assert.equal(result.assignment.createdAt, original.createdAt); assert.equal(result.assignment.instructions, original.instructions);
      assert.equal(result.assignment.conflictOverride, undefined);
      assert.equal(result.assignment.calendarChange.previousEnd, original.end);
      assert.doesNotMatch(result.assignment.note, /cancelled|past appointment/);
    }
  }
  const shortened = calendarTimeChange(original, { ...appointment, end: "2026-10-17T17:45:00Z" }, now);
  assert.equal(shortened.assignment.status, "accepted", "a corrected duration also preserves the original response");
  assert.equal(calendarTimeChange(original, { ...appointment, end: "2026-10-17T14:00:00-04:00" }, now), null, "equivalent instants are unchanged");
});

test("actual start-time reschedules and removals retain their existing safeguards", () => {
  const future = calendarTimeChange(original, { ...appointment, start: "2026-10-18T17:30:00Z", end: "2026-10-18T18:30:00Z" }, now);
  assert.equal(future.assignment.status, "pending"); assert.equal(future.event, "rescheduled");
  const past = calendarTimeChange(original, { ...appointment, start: "2026-10-17T17:00:00Z" }, now);
  assert.equal(past.assignment.status, "cancelled"); assert.equal(past.event, "past");
  assert.equal(calendarTimeChange(original, undefined, now).event, "removed");
  for (const status of ["declined", "cancelled"]) assert.equal(calendarTimeChange({ ...original, status }, appointment, now), null);
});

test("duration notices describe the saved response without demanding acceptance again", () => {
  const accepted = assignmentNotifications({ ...original, end: appointment.end }, "duration", ["owner", "akiva"]);
  assert.ok(accepted.every(n => /acceptance is kept/.test(n.body)));
  assert.ok(accepted.every(n => !/cancelled|Tap to accept|new acceptance/.test(n.body)));
  const pending = assignmentNotifications({ ...original, status: "pending" }, "duration", ["akiva"])[0];
  assert.match(pending.body, /awaiting a response/); assert.doesNotMatch(pending.body, /acceptance is kept/);
});

test("legacy recovery proves the prior response and unchanged start from exact saved history", () => {
  const result = recoverDurationCancellation(cancelled, appointment, [cancelled], history(), now);
  assert.equal(result.assignment.status, "accepted"); assert.equal(result.assignment.end, appointment.end);
  assert.equal(result.assignment.calendarChange.previousEnd, original.end);
  assert.equal(result.assignment.calendarChange.evidenceId, "notice-2");
  assert.deepEqual(result.correctedAlerts.map(a => a.id).sort(), ["notice-3", "notice-4"]);
  const pendingHistory = history().filter(row => row.sequence !== 2);
  assert.equal(recoverDurationCancellation(cancelled, appointment, [cancelled], pendingHistory, now).assignment.status, "pending");
  const rescheduled = history();
  rescheduled[1] = notice(original, "rescheduled", "owner", original.updatedAt, 2);
  assert.equal(recoverDurationCancellation(cancelled, appointment, [cancelled], rescheduled, now).assignment.status, "pending");
});

test("recovery never revives deliberate removals, other time changes, or unsupported history", () => {
  const cases = [
    { a: { ...cancelled, note: "Appointment removed from Calendar." } },
    { a: { ...cancelled, removeCalendarGuest: true } },
    { a: { ...cancelled, calendarChange: { kind: "past" } } },
    { p: { ...appointment, end: "2026-10-17T19:00:00Z" } },
    { p: undefined },
    { h: [] },
    { h: history().slice(0, 2) },
    { h: history().map(row => row.sequence === 2 ? { ...row, body: row.body.replace("1:30 PM", "1:00 PM") } : row) },
    { h: history().map(row => row.sequence === 2 ? { ...row, body: row.body.replace("2:00 PM", "3:00 PM") } : row) },
    { h: [...history(), notice(original, "declined", "owner", "2026-10-17T20:00:00Z", 5)] },
    { h: [...history(), notice(original, "cancelled", "akiva", "2026-10-17T21:04:00Z", 5)] },
    { others: [{ ...original, id: "replacement" }] },
  ];
  for (const c of cases) assert.equal(recoverDurationCancellation(c.a ?? cancelled, "p" in c ? c.p : appointment,
    [cancelled, ...(c.others ?? [])], c.h ?? history(), now), null, JSON.stringify(c));
});

async function importSchedule(f, p = appointment) {
  const generation = crypto.randomUUID();
  assert.equal((await f.call("sync", "/sync/import", { generation, appointments: [p] })).status, 200);
  const result = await f.call("sync", "/sync/commit", { generation, count: 1 });
  await Promise.allSettled(f.pending);
  return result;
}
function seedAssignment(f, assignment) {
  f.DB.sqlite.prepare("INSERT INTO team_assignments (id, employee_id, data) VALUES (?, ?, ?)").run(assignment.id, assignment.employeeId, JSON.stringify(assignment));
  f.DB.sqlite.prepare("INSERT INTO calendar_assignment_outbox (assignment_id, version, status, result, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(assignment.id, "old-version", "stale", JSON.stringify({ code: "event_started" }), Date.parse(assignment.updatedAt));
}
function seedHistory(f, rows) {
  for (const r of rows) f.DB.sqlite.prepare(`INSERT INTO team_inbox (id, user_id, kind, title, body, target, target_id, person_id, created_at, read_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(r.id, r.user_id, r.kind, r.title, r.body, r.target, r.target_id, r.person_id, r.created_at, r.read_at, r.deleted_at);
}

test("real sync keeps completed rental staffing, exports the new hours, and imports Google status without replay", async t => {
  t.mock.method(Date, "now", () => now);
  const f = await fixture(); delete f.env.VAPID_JWK;
  try {
    seedAssignment(f, original);
    assert.equal((await importSchedule(f)).status, 200);
    const a = (await f.call("akiva", "/schedule")).data.assignments[0];
    assert.equal(a.status, "accepted"); assert.equal(a.end, appointment.end);
    assert.equal(a.calendarSync.status, "synced"); assert.equal(a.calendarSync.googleStatus, "accepted");
    assert.equal(a.calendarSync.code, "calendar_imported");
    const q = f.DB.sqlite.prepare("SELECT * FROM calendar_assignment_outbox").get();
    assert.notEqual(q.version, "old-version"); assert.equal(q.attempts, 0);
    const exported = (await f.call("sync", "/sync/accepted")).data.assignments;
    assert.deepEqual(exported, [{ appointmentId: original.appointmentId, employeeId: original.employeeId, start: appointment.start, end: appointment.end }]);
    const alerts = f.DB.sqlite.prepare("SELECT * FROM team_inbox").all();
    assert.equal(alerts.length, 2); assert.ok(alerts.every(row => !/cancelled/.test(row.body)));
    assert.equal((await importSchedule(f)).status, 200);
    assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) n FROM team_inbox").get().n, 2, "repeated imports are quiet");
  } finally { await Promise.allSettled(f.pending); f.close(); }
});

test("legacy sync repair is idempotent, corrects existing alerts, and does not send notifications", async t => {
  t.mock.method(Date, "now", () => now);
  const f = await fixture(); delete f.env.VAPID_JWK;
  try {
    seedAssignment(f, cancelled);
    const rows = history(); rows[2].read_at = now - 1000; rows[3].deleted_at = now - 500;
    seedHistory(f, rows);
    assert.equal((await importSchedule(f)).status, 200);
    const a = (await f.call("akiva", "/schedule")).data.assignments[0];
    assert.equal(a.status, "accepted"); assert.equal(a.calendarChange.kind, "duration_recovered");
    assert.equal(a.calendarSync.googleStatus, "accepted");
    const corrected = f.DB.sqlite.prepare("SELECT * FROM team_inbox WHERE id IN ('notice-3', 'notice-4') ORDER BY id").all();
    assert.ok(corrected.every(row => /duration updated/.test(row.title)));
    assert.equal(corrected[0].read_at, rows[2].read_at); assert.equal(corrected[1].deleted_at, rows[3].deleted_at);
    assert.equal(corrected[0].created_at, rows[2].created_at);
    assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) n FROM team_notification_events").get().n, 0);
    const exported = (await f.call("sync", "/sync/accepted")).data;
    assert.equal(exported.assignments.length, 1); assert.deepEqual(exported.durationRecovery, { restored: 1, needsReview: 0 });
    assert.equal((await importSchedule(f)).status, 200);
    assert.equal((await f.call("akiva", "/schedule")).data.assignments[0].updatedAt, a.updatedAt);
    assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) n FROM team_inbox").get().n, 4);
  } finally { await Promise.allSettled(f.pending); f.close(); }
});

test("a concurrent schedule mutation prevents repair, alert correction and outbox invalidation together", async t => {
  t.mock.method(Date, "now", () => now);
  const f = await fixture(); delete f.env.VAPID_JWK;
  try {
    seedAssignment(f, cancelled); seedHistory(f, history());
    const batch = f.DB.batch.bind(f.DB);
    f.DB.batch = async statements => { f.DB.sqlite.prepare("UPDATE team_state SET revision = revision + 1 WHERE id = 1").run(); return batch(statements); };
    assert.equal((await importSchedule(f)).status, 409);
    assert.equal(JSON.parse(f.DB.sqlite.prepare("SELECT data FROM team_assignments").get().data).status, "cancelled");
    assert.equal(f.DB.sqlite.prepare("SELECT version FROM calendar_assignment_outbox").get().version, "old-version");
    assert.equal(f.DB.sqlite.prepare("SELECT title FROM team_inbox WHERE id = 'notice-3'").get().title, "Changed rental needs review");
  } finally { await Promise.allSettled(f.pending); f.close(); }
});
