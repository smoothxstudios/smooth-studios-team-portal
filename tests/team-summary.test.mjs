import assert from 'node:assert/strict';
import test from 'node:test';
import { teamEarnings, weeklyTeamHours } from '../lib/team-summary.mjs';
const now = Date.parse('2026-10-17T12:00:00Z');
const employees = [{ id: 'akiva', name: 'Akiva' }, { id: 'rayne', name: 'Rayne' }];
const base = { id: 'rental', start: '2026-10-16T13:00Z', end: '2026-10-16T15:00Z', fullyPaid: true, priceCents: 10000, paidOnlineCents: 10000, assignedEmployeeIds: ['akiva'], employeePayouts: { akiva: { amountCents: 3000, paidAmountCents: 1500, outstandingCents: 1500, paid: false } } };
test('per-person pay includes only earned work, preserves advance credits and exact cents, and never borrows another person’s pay', () => {
  const creative = [{ employeeId: 'akiva', status: 'approved', amountCents: 10001, payments: [{ amountCents: 2000 }], advanceAppliedCents: 3000 }, { employeeId: 'akiva', status: 'submitted', amountCents: 5000 }];
  const rows = teamEarnings(employees, [base, { ...base, fullyPaid: false, paymentOverride: false }, { ...base, end: '2026-10-20T15:00Z' }], creative, now);
  assert.deepEqual([rows[0].earned, rows[0].owed, rows[0].settled, rows[0].projected], [13001, 6501, 6500, 8000]);
  assert.equal(rows[0].earned, rows[0].owed + rows[0].settled);
  assert.equal(rows[1].earned, 0); assert.equal(rows[1].owed, 0);
});
test('hours use Eastern Monday boundaries, clip overnight work, deduplicate accepted sources, and exclude pending, ongoing and cancelled work', () => {
  const overnight = { id: 'overnight', start: '2026-10-12T03:00Z', end: '2026-10-12T05:00Z', acceptedEmployeeIds: ['akiva'] };
  const appointment = { ...base, acceptedEmployeeIds: ['akiva'] };
  const accepted = { ...base, id: 'offer', employeeId: 'akiva', appointmentId: 'rental', status: 'accepted' };
  const task = { id: 'task', employeeId: 'akiva', appointmentId: null, start: '2026-10-16T14:00Z', end: '2026-10-16T16:00Z', status: 'accepted' };
  const schedule = { appointments: [overnight, appointment], assignments: [accepted, task, { ...task, id: 'cancelled', status: 'cancelled', end: '2026-10-16T23:00Z' }, { ...task, id: 'pending', status: 'pending', end: '2026-10-16T22:00Z' }, { ...task, id: 'ongoing', start: '2026-10-17T11:00Z', end: '2026-10-17T13:00Z' }] };
  const result = weeklyTeamHours(employees, [base], schedule, now);
  assert.equal(result.from, '2026-10-12T04:00:00.000Z'); assert.equal(result.through, '2026-10-18');
  assert.equal(result.people[0].hours, 4); assert.equal(result.people[1].hours, 0);
  assert.equal(weeklyTeamHours(employees, [base], { appointments: [], assignments: [accepted] }, now).people[0].hours, 0);
  assert.equal(weeklyTeamHours(employees, [{ ...base, fullyPaid: false }], null, now).people[0].hours, 2);
});
test('the week containing a daylight-saving transition uses actual elapsed durations', () => {
  const end = Date.parse('2026-11-02T04:59:00Z');
  const rentals = [{ ...base, start: '2026-11-01T04:30:00Z', end: '2026-11-01T07:30:00Z' }];
  const result = weeklyTeamHours(employees, rentals, null, end);
  assert.equal(result.from, '2026-10-26T04:00:00.000Z'); assert.equal(result.people[0].hours, 3);
});
