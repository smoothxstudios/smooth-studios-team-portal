import assert from "node:assert/strict";
import test from "node:test";
import { ownerPeriodFinances } from "../lib/owner-finances.mjs";

const now = Date.parse("2026-10-16T12:00:00Z");
const rental = (extra = {}) => ({ id: "example", start: "2026-10-14T14:00:00Z", end: "2026-10-14T15:00:00Z",
  priceCents: 10000, paidOnlineCents: 10000, fullyPaid: true,
  employeePayouts: { test: { amountCents: 2000, paid: false } }, ...extra });
const creative = (extra = {}) => ({ status: "approved", approvedAt: "2026-10-15T14:00:00Z", amountCents: 3000,
  payments: [{ amountCents: 1000 }], ...extra });

test("weekly and monthly figures include tips and earned payroll, with partial payments counted once", () => {
  const rows = [rental({ paidOnlineCents: 11000 }), rental({ id: "earlier", start: "2026-10-02T14:00:00Z", end: "2026-10-02T15:00:00Z", employeePayouts: { test: { amountCents: 2000, paid: true } } })];
  const [week, month] = ownerPeriodFinances(rows, [creative()], now);
  assert.equal(week.revenue, 11000);
  assert.equal(week.teamPay, 5000);
  assert.equal(week.stillOwed, 4000);
  assert.equal(week.afterTeamPay, 6000);
  assert.equal(month.revenue, 21000);
  assert.equal(month.teamPay, 7000);
  assert.equal(month.afterTeamPay, 14000);
  rows[0].employeePayouts.test.paid = true;
  const paid = ownerPeriodFinances(rows, [creative({ payments: [{ amountCents: 3000 }] })], now)[0];
  assert.equal(paid.stillOwed, 0);
  assert.equal(paid.afterTeamPay, week.afterTeamPay);
});

test("deposits, manual unpaid decisions, future rentals, and unapproved creative work do not inflate totals", () => {
  const rows = [rental({ fullyPaid: false, paidOnlineCents: 2500 }), rental({ paymentOverride: false, fullyPaid: false, paidOnlineCents: 15000 }),
    rental({ start: "2026-10-17T14:00:00Z", end: "2026-10-17T15:00:00Z" }), rental({ end: "2026-10-16T13:00:00Z" })];
  const [week] = ownerPeriodFinances(rows, [creative({ status: "submitted" }), creative({ approvedAt: "2026-10-17T14:00:00Z" })], now);
  assert.equal(week.revenue, 0); assert.equal(week.teamPay, 0); assert.equal(week.afterTeamPay, 0);
  const manual = ownerPeriodFinances([rental({ paymentOverride: true, fullyPaid: true, paidOnlineCents: null })], [], now)[0];
  assert.equal(manual.revenue, 10000);
});

test("week and month boundaries use Eastern time, including the daylight-saving transition", () => {
  const check = Date.parse("2026-11-02T07:00:00Z");
  const beforeMonday = rental({ start: "2026-11-02T04:30:00Z", end: "2026-11-02T04:45:00Z" });
  const monday = rental({ start: "2026-11-02T05:00:00Z", end: "2026-11-02T06:00:00Z" });
  const october = rental({ start: "2026-11-01T03:00:00Z", end: "2026-11-01T03:30:00Z" });
  const [week, month] = ownerPeriodFinances([beforeMonday, monday, october], [], check);
  assert.equal(week.start, "2026-11-02T05:00:00.000Z");
  assert.equal(month.start, "2026-11-01T04:00:00.000Z");
  assert.equal(week.revenue, 10000); assert.equal(month.revenue, 20000);
});

test("negative remainders are retained and unknown pay rates are flagged", () => {
  const [week] = ownerPeriodFinances([rental({ employeePayouts: { test: { amountCents: 0, compensationConfigured: false } } })], [creative({ amountCents: 12000 })], now);
  assert.equal(week.missingRates, 1);
  assert.equal(week.afterTeamPay, -2000);
});

test("manual training pay belongs to its work period rather than its recording period", () => {
  const manual = creative({entryType: 'manual', earnedAt: '2026-10-02T16:00:00Z', approvedAt: '2026-10-15T14:00:00Z'});
  const [week, month] = ownerPeriodFinances([], [manual], now);
  assert.equal(week.teamPay, 0); assert.equal(month.teamPay, 3000); assert.equal(month.stillOwed, 2000);
});
