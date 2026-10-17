import assert from "node:assert/strict";
import test from "node:test";
import { agendaMatchesStatus, agendaOnDay, agendaWeek, buildScheduleAgenda } from "../lib/schedule-agenda.mjs";
import { localInstant } from "../lib/team-schedule.mjs";
import { assignmentResponseLabel } from "../lib/calendar-invitations.mjs";

const period = { start: localInstant("2026-10-16T14:00"), end: localInstant("2026-10-16T16:00") };
const booking = { id: "rental-1", title: "Studio A Rental", customer: "Example Client", priceCents: 10000, ...period, acceptedEmployeeIds: [] };
const offer = (id, employeeId, status = "pending", appointmentId = booking.id) => ({ id, employeeId, status, appointmentId, title: booking.title, ...period });
const schedule = (assignments = [], appointments = [booking], rest = {}) => ({ assignments, appointments, blocks: [], workPreferences: [], ...rest });
const options = { from: localInstant("2026-10-16T00:00"), to: localInstant("2026-10-17T00:00") };

test("one Calendar booking groups all portal offers without duplicate staff", () => {
  const result = buildScheduleAgenda(schedule([offer("a", "jordyn", "accepted"), offer("b", "akiva"), offer("c", "rayne", "declined")], [{ ...booking, acceptedEmployeeIds: ["jordyn"] }]), options);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].confirmedIds, ["jordyn"]);
  assert.deepEqual(result[0].pendingIds, ["akiva"]);
  assert.deepEqual(result[0].confirmations, [
    { employeeId: "jordyn", appStatus: "accepted", calendarAccepted: true },
    { employeeId: "akiva", appStatus: "pending", calendarAccepted: false },
  ]);
  assert.equal(result[0].assignments.length, 3);
  assert.equal(result[0].status, "confirmed");
  assert.equal(agendaMatchesStatus(result[0], "confirmed"), true);
  assert.equal(agendaMatchesStatus(result[0], "pending"), true, "extra pending staff remain findable on a confirmed booking");
});

test("app acceptance and Google RSVPs remain independent confirmation sources", () => {
  const [item] = buildScheduleAgenda(schedule([
    offer("a", "jordyn", "accepted"), offer("b", "akiva"),
    offer("c", "amia", "declined"), offer("d", "terrill", "cancelled"),
  ], [{ ...booking, acceptedEmployeeIds: ["akiva", "rayne"] }]), options);
  assert.deepEqual(item.confirmations, [
    { employeeId: "akiva", appStatus: "pending", calendarAccepted: true },
    { employeeId: "rayne", appStatus: null, calendarAccepted: true },
    { employeeId: "jordyn", appStatus: "accepted", calendarAccepted: false },
  ]);
  assert.equal(agendaMatchesStatus(item, "pending", "akiva"), true, "Calendar acceptance must not hide a pending app response");
  assert.equal(agendaMatchesStatus(item, "confirmed", "akiva"), true);
  assert.equal(item.confirmations.find(p => p.employeeId === "jordyn").calendarAccepted, false, "app acceptance does not fabricate a Google RSVP");
  assert.equal(item.confirmations.find(p => p.employeeId === "rayne").appStatus, null, "a Google RSVP does not fabricate app acceptance");
});

test("employee filters find their pending Calendar offer, but not a different person's status", () => {
  const data = schedule([offer("a", "jordyn", "accepted"), offer("b", "akiva")]);
  const [akiva] = buildScheduleAgenda(data, { ...options, employeeId: "akiva" });
  assert.ok(akiva);
  assert.equal(agendaMatchesStatus(akiva, "pending", "akiva"), true);
  assert.equal(agendaMatchesStatus(akiva, "confirmed", "akiva"), false);
  assert.equal(agendaMatchesStatus(akiva, "pending", "jordyn"), false);
  assert.equal(buildScheduleAgenda(data, { ...options, employeeId: "rayne" }).length, 0);
});

test("cancelled and declined offers do not count as staffing; history stays attached", () => {
  const result = buildScheduleAgenda(schedule([offer("a", "jordyn", "cancelled"), offer("b", "akiva", "declined")]), options);
  assert.equal(result[0].status, "unassigned");
  assert.equal(result[0].assignments.length, 2);
  assert.deepEqual(result[0].employeeIds, []);
  assert.equal(agendaMatchesStatus(result[0], "unassigned"), true);
  assert.equal(buildScheduleAgenda(schedule([offer("a", "jordyn", "cancelled")]), { ...options, employeeId: "jordyn" }).length, 0);
});

test("standalone tasks and offers with missing Calendar records remain visible", () => {
  const data = schedule([offer("a", "jordyn", "pending", null), offer("b", "akiva", "accepted", "missing"), offer("c", "rayne", "cancelled", null)], []);
  const result = buildScheduleAgenda(data, options);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(item => item.id), ["assignment:a", "assignment:b"]);
});

test("search matches customer, package, accents, and active team members together", () => {
  const data = schedule([offer("a", "jordyn")], [{ ...booking, customer: "Renée Sample" }]);
  assert.equal(buildScheduleAgenda(data, { ...options, query: "RENEE jordyn studio" }).length, 1);
  assert.equal(buildScheduleAgenda(data, { ...options, query: "Renée rayne" }).length, 0);
});

test("recurring availability, multi-day work, and DST are grouped by Eastern dates", () => {
  const overnight = { ...booking, start: localInstant("2026-10-31T23:30"), end: localInstant("2026-11-01T02:30") };
  const data = schedule([], [overnight], {
    blocks: [{ id: "class", userId: "jordyn", reason: "Class", startLocal: "2026-10-25T09:00", endLocal: "2026-10-25T10:00", repeatUntil: "2026-11-08" }],
    workPreferences: [{ id: "hours", userId: "akiva", note: "Available", startLocal: "2026-11-01T00:00", endLocal: "2026-11-02T00:00", allDay: true, repeatUntil: null }],
  });
  const result = buildScheduleAgenda(data, { from: localInstant("2026-10-31T00:00"), to: localInstant("2026-11-03T00:00") });
  assert.equal(agendaOnDay(result, "2026-10-31").length, 1);
  assert.equal(agendaOnDay(result, "2026-11-01").length, 3);
  assert.equal(agendaOnDay(result, "2026-11-02").length, 0, "midnight end does not leak into next day");
  assert.equal(result.find(item => item.kind === "block").start, "2026-11-01T14:00:00.000Z");
  assert.equal(result.filter(item => agendaMatchesStatus(item, "all")).length, 1, "availability is separate from work totals");
  assert.deepEqual(agendaWeek("2026-11-01"), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
});

test("calendar time is authoritative when a linked offer has a stale time", () => {
  const stale = { ...offer("a", "jordyn"), start: localInstant("2026-10-18T14:00"), end: localInstant("2026-10-18T15:00") };
  const result = buildScheduleAgenda(schedule([stale]), options);
  assert.equal(result.length, 1);
  assert.equal(result[0].start, booking.start);
  assert.deepEqual(result[0].pendingIds, ["jordyn"]);
});

test("Calendar invitations appear as pending with their Google response source and no invented app acceptance", () => {
  const invited = { ...booking, calendarInvitations: [{ employeeId: "jordyn", status: "needsAction" },
    { employeeId: "akiva", status: "tentative" }, { employeeId: "rayne", status: "declined" }] };
  const [item] = buildScheduleAgenda(schedule([offer("old", "jordyn", "declined")], [invited]), options);
  assert.deepEqual(item.confirmedIds, []);
  assert.deepEqual(item.pendingIds, ["jordyn", "akiva"]);
  assert.deepEqual(item.confirmations, [
    { employeeId: "jordyn", appStatus: null, calendarAccepted: false, calendarStatus: "needsAction" },
    { employeeId: "akiva", appStatus: null, calendarAccepted: false, calendarStatus: "tentative" },
  ]);
  assert.equal(item.status, "pending");
  assert.deepEqual(item.confirmations.map(assignmentResponseLabel), ["Invited in Google Calendar", "Tentative in Google Calendar"]);
  assert.equal(item.assignments[0].status, "declined");
  assert.equal(buildScheduleAgenda(schedule([], [invited]), { ...options, employeeId: "akiva" }).length, 1);
  assert.equal(buildScheduleAgenda(schedule([], [invited]), { ...options, employeeId: "rayne" }).length, 0);
  assert.deepEqual(buildScheduleAgenda(schedule([], [{ ...invited, calendarInvitations: [] }]), options)[0].employeeIds, []);
  for (const status of ["pending", "accepted"]) {
    const [withApp] = buildScheduleAgenda(schedule([offer("app", "jordyn", status)], [invited]), options);
    assert.equal(withApp.assignments.length, 1);
    assert.equal(withApp.confirmations.filter(person => person.employeeId === "jordyn").length, 1);
    assert.equal(withApp.confirmations[0].appStatus, status);
    assert.equal(withApp.confirmations[0].calendarAccepted, false, "app acceptance never fabricates a Google RSVP");
    assert.equal(withApp.confirmations[0].calendarStatus, "needsAction");
  }
});
