import test from "node:test";
import assert from "node:assert/strict";
import { employeeHomeWork, employeeEarningsForYear } from "../lib/employee-home.mjs";

const now = Date.parse("2026-10-15T12:00:00Z");
const appointment = { id: "calendar-1", title: "Studio A Rental", customer: "Test Client", start: "2026-10-16T17:00:00Z", end: "2026-10-16T18:00:00Z", priceCents: 5000, acceptedEmployeeIds: ["jordyn"] };
const assignment = { id: "offer-1", appointmentId: appointment.id, employeeId: "jordyn", title: appointment.title, start: appointment.start, end: appointment.end, instructions: "Set up two lights.", status: "accepted" };
const snapshot = { ...appointment, paidOnlineCents: 5000, fullyPaid: true, assignedEmployeeIds: ["jordyn"], employeePayouts: { jordyn: { amountCents: 2000, paid: false } } };
const schedule = { appointments: [appointment], assignments: [assignment], blocks: [], revision: 1 };

test("home deduplicates Calendar acceptance and portal work while retaining instructions", () => {
  const work = employeeHomeWork("jordyn", schedule, [snapshot], now);
  assert.equal(work.upcoming.length, 1);
  assert.equal(work.upcoming[0].instructions, "Set up two lights.");
  assert.equal(work.upcoming[0].customer, "Test Client");
  assert.equal(work.offers.length, 0);
});

test("live cancellation and time changes take precedence over an older encrypted snapshot", () => {
  const changed = { ...assignment, status: "pending", start: "2026-10-16T19:00:00Z", end: "2026-10-16T20:00:00Z" };
  const result = employeeHomeWork("jordyn", { ...schedule, appointments: [], assignments: [changed] }, [snapshot], now);
  assert.equal(result.upcoming.length, 0);
  assert.equal(result.offers[0].start, changed.start);
  const cancelled = employeeHomeWork("jordyn", { ...schedule, appointments: [], assignments: [{ ...assignment, status: "cancelled" }] }, [snapshot], now);
  assert.equal(cancelled.upcoming.length, 0);
  assert.equal(cancelled.updates.length, 1);
  assert.equal(employeeHomeWork("jordyn", null, [snapshot], now).upcoming[0].status, "Previously synced");
});

test("home includes custom work, ongoing appointments, and pending review, but excludes other employees and ended work", () => {
  const own = { ...assignment, id: "custom", appointmentId: null, title: "Prepare studio", start: "2026-10-15T11:00:00Z", end: "2026-10-15T13:00:00Z" };
  const pending = { ...own, id: "late-offer", status: "pending" };
  const others = { ...own, id: "other", employeeId: "rayne" };
  const ended = { ...own, id: "ended", end: "2026-10-15T12:00:00Z" };
  const result = employeeHomeWork("jordyn", { ...schedule, appointments: [], assignments: [own, pending, others, ended] }, [], now);
  assert.deepEqual(result.upcoming.map(a => a.id), ["custom"]);
  assert.deepEqual(result.offers.map(a => a.id), ["late-offer"]);
  assert.equal(employeeHomeWork("rayne", null, [snapshot], now).upcoming.length, 0);
});

test("home shows Calendar invites separately from confirmed work and dashboard offers", () => {
  const invited = { ...appointment, acceptedEmployeeIds: [], calendarInvitations: [{ employeeId: "jordyn", status: "needsAction" }] };
  const data = { ...schedule, appointments: [invited], assignments: [] };
  const result = employeeHomeWork("jordyn", data, [], now);
  assert.equal(result.calendarInvitations.length, 1);
  assert.equal(result.calendarInvitations[0].calendarStatus, "needsAction");
  assert.equal(result.upcoming.length, 0);
  assert.equal(result.offers.length, 0);
  assert.equal(employeeHomeWork("rayne", data, [], now).calendarInvitations.length, 0);
  assert.equal(employeeHomeWork("jordyn", { ...data, assignments: [{ ...assignment, status: "pending" }] }, [], now).calendarInvitations.length, 0);
  assert.equal(employeeHomeWork("jordyn", { ...data, assignments: [assignment] }, [], now).calendarInvitations.length, 0);
  assert.equal(employeeHomeWork("jordyn", { ...data, appointments: [{ ...invited, calendarInvitations: [] }] }, [], now).calendarInvitations.length, 0);
  assert.equal(employeeHomeWork("jordyn", { ...data, appointments: [{ ...invited, acceptedEmployeeIds: ["jordyn"] }] }, [], now).upcoming.length, 1);
});

test("earnings retain partial payouts, deposits, tips, manual decisions, and projected amounts", () => {
  const past = { ...snapshot, start: "2026-10-10T17:00:00Z", end: "2026-10-10T18:00:00Z" };
  const rentals = [
    { ...past, employeePayouts: { jordyn: { amountCents: 2000, paidAmountCents: 1500, outstandingCents: 500, paid: false } } },
    { ...past, id: "deposit", fullyPaid: false, paidOnlineCents: 2500 },
    { ...past, id: "tip", fullyPaid: false, paidOnlineCents: 6000 },
    { ...past, id: "manual-unpaid", paymentOverride: true, fullyPaid: false, paidOnlineCents: 6000 },
    snapshot,
  ];
  const result = employeeEarningsForYear(rentals, "jordyn", 2026, now);
  assert.equal(result.metrics.paid, 1500);
  assert.equal(result.metrics.owed, 2500);
  assert.equal(result.metrics.projected, 2000);
  assert.equal(result.monthly[9].owed, 2500);
});

test("earnings year and month use Eastern time and restrict results to the employee", () => {
  const boundary = { ...snapshot, start: "2027-01-01T02:00:00Z", end: "2027-01-01T03:00:00Z" };
  const result = employeeEarningsForYear([boundary], "jordyn", 2026, Date.parse("2027-01-02T00:00:00Z"));
  assert.equal(result.rentals.length, 1);
  assert.equal(result.monthly[11].owed, 2000);
  assert.equal(employeeEarningsForYear([boundary], "jordyn", 2027, now).rentals.length, 0);
  assert.equal(employeeEarningsForYear([boundary], "rayne", 2026, now).rentals.length, 0);
});
