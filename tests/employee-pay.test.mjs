import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { calculateEmployeePayout, initializePayAdjustments, markEmployeeThrough } from "../scripts/lib/employee-pay.mjs";
import { buildDashboardPayloads } from "../scripts/lib/dashboard-data.mjs";

const config = JSON.parse(await readFile(new URL("../config/studio.config.json", import.meta.url), "utf8"));
const jordyn = config.employees.find(e => e.id === "jordyn");
const originalLedger = () => initializePayAdjustments(config, { employees: { jordyn: { paidThrough: "2026-09-26" } } });
const payout = (options = {}) => calculateEmployeePayout({ employee: jordyn, config, ledger: originalLedger(), priceCents: 5000,
  start: "2026-09-26T18:00:00-04:00", end: "2026-09-26T19:00:00-04:00", categoryId: "studio-rentals", fullyPaid: true,
  now: Date.parse("2026-10-14T06:00:00Z"), ...options });

test("Jordyn earns $20 on a $50 appointment from September 26 in Eastern time", () => {
  assert.equal(payout().amountCents, 2000);
  assert.equal(payout({ start: "2026-09-26T03:59:00Z", end: "2026-09-26T04:59:00Z" }).amountCents, 1500);
  assert.equal(payout({ start: "2026-09-26T04:00:00Z", end: "2026-09-26T05:00:00Z" }).amountCents, 2000);
  assert.equal(payout({ priceCents: 10000 }).amountCents, 4000);
  assert.equal(payout({ employee: config.employees.find(e => e.id === "akiva") }).amountCents, 1500);
});

test("the raise preserves $15 paid and leaves $5 owed until explicitly marked paid", () => {
  const ledger = originalLedger();
  const first = payout({ ledger });
  assert.equal(first.paidAmountCents, 1500);
  assert.equal(first.outstandingCents, 500);
  assert.equal(first.paid, false);
  initializePayAdjustments(config, ledger);
  assert.deepEqual(payout({ ledger }), first);
  markEmployeeThrough(ledger.employees.jordyn, "2026-09-25");
  assert.equal(payout({ ledger }).outstandingCents, 500);
  markEmployeeThrough(ledger.employees.jordyn, "2026-09-26");
  const settled = payout({ ledger });
  assert.equal(settled.paidAmountCents, 2000);
  assert.equal(settled.outstandingCents, 0);
  assert.equal(settled.paid, true);
});

test("unpaid and future appointments use the new rate without inventing payments", () => {
  assert.equal(payout({ ledger: { employees: {} } }).outstandingCents, 2000);
  assert.equal(payout({ fullyPaid: false }).paidAmountCents, 0);
  assert.equal(payout({ now: Date.parse("2026-09-25") }).paid, false);
  const future = payout({ start: "2026-11-01T18:00:00-05:00", end: "2026-11-01T19:00:00-05:00" });
  assert.equal(future.amountCents, 2000);
  assert.equal(future.paidAmountCents, 0);
});

test("Calendar and portal acceptance use the same rate and private employee view", () => {
  const configured = { ...config, employees: config.employees.map(e => ({ ...e, email: `${e.id}@example.invalid` })) };
  const event = { id: "fixture-rate-change", summary: "Client: Studio Rental", start: { dateTime: "2026-09-26T18:00:00-04:00" }, end: { dateTime: "2026-09-26T19:00:00-04:00" },
    description: "Price: $50.00\nPaid Online: $60.00", attendees: [{ email: "jordyn@example.invalid", responseStatus: "accepted" }] };
  const options = { calendarEvents: [event], config: configured, ledger: originalLedger(), overrides: {}, source: "google-calendar" };
  const calendar = buildDashboardPayloads(options);
  const portal = buildDashboardPayloads({ ...options, calendarEvents: [{ ...event, attendees: [] }], portalAssignments: [{ appointmentId: event.id, employeeId: "jordyn", start: event.start.dateTime, end: event.end.dateTime }] });
  assert.deepEqual(portal.jordyn.rentals[0].employeePayouts, calendar.jordyn.rentals[0].employeePayouts);
  assert.equal(portal.owner.rentals[0].employeePayouts.jordyn.amountCents, 2000);
  assert.equal(portal.owner.rentals[0].employeePayouts.jordyn.outstandingCents, 500);
  assert.deepEqual(Object.keys(portal.jordyn.rentals[0].employeePayouts), ["jordyn"]);
});

test("new hires never inherit the legacy 30% while their pay is unset", () => {
  const employee = config.employees.find(e => e.id === "dacari");
  const pending = payout({ employee });
  assert.equal(pending.amountCents, 0);
  assert.equal(pending.compensationConfigured, false);
  assert.equal(pending.paid, false);
  const hourly = { ...employee, compensation: { type: "hourly", hourlyCents: 1500 } };
  assert.equal(payout({ employee: hourly, end: "2026-09-26T19:30:00-04:00" }).amountCents, 2250);
  assert.equal(payout({ employee: hourly, categoryId: "studio-packages" }).compensationConfigured, false);
});
