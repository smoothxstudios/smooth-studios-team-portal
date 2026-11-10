import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/notification-fixture.mjs';
import { paymentAccounts } from '../team-api/payroll-payments.mjs';
import { rentalDeductionDateEligible } from '../lib/team-rental-policy.mjs';
import { buildDashboardPayloads } from '../scripts/lib/dashboard-data.mjs';

const now = Date.parse('2026-11-10T18:00:00Z');
const booking = (id, start, overrides = {}) => ({
  id, start, end: new Date(Date.parse(start) + 3600000).toISOString(), title: 'Studio A Rental',
  customer: 'Rayne', teamRenterId: 'rayne', priceCents: 6000, paidOnlineCents: 3500,
  acceptedEmployeeIds: [], ...overrides,
});
function put(f, a) {
  f.DB.sqlite.prepare('INSERT OR REPLACE INTO team_appointments(generation,id,data) VALUES (?,?,?)').run('', a.id, JSON.stringify(a));
}

test('cutoff is inclusive September 25 in studio time, using the start of overnight rentals', async () => {
  const f = await fixture();
  put(f, booking('earlier-evening', '2026-09-25T03:59:00Z'));
  put(f, booking('cutoff', '2026-09-25T04:00:00Z'));
  put(f, booking('summer', '2026-06-26T17:00:00Z'));
  put(f, booking('dst', '2026-11-01T06:00:00Z'));
  put(f, booking('future', '2026-11-11T17:00:00Z'));
  put(f, booking('cancelled', '2026-11-07T17:00:00Z', { cancelled: true }));
  const state = await paymentAccounts(f.DB, 'rayne', now);
  assert.deepEqual(state.rentalCharges.map(c => c.rentalId), ['cutoff', 'dst']);
  assert.equal(state.accounts[0].rentalBalanceCents, 12000);
  assert.equal(rentalDeductionDateEligible(undefined), false);
  assert.equal(rentalDeductionDateEligible('not a date'), false);
  f.close();
});

test('full booking prices count for paid, partly paid, unpaid, and manual-paid rentals', async () => {
  const f = await fixture();
  for (const [id, paidOnlineCents, fullyPaid] of [['paid', 6000, true], ['partial', 3500, false], ['unpaid', 0, false], ['manual', null, true], ['tip', 8000, true]]) {
    put(f, booking(id, '2026-11-07T17:00:00Z', { paidOnlineCents, fullyPaid }));
  }
  const state = await paymentAccounts(f.DB, 'rayne', now);
  assert.equal(state.rentalCharges.length, 5);
  assert.ok(state.rentalCharges.every(c => c.amountCents === 6000 && c.outstandingCents === 6000));
  assert.equal(state.accounts[0].carryForwardCents, 30000);
  assert.equal(state.accounts[0].payableCents, 0);
  f.close();
});

test('saved deductions are credited once and earlier settlements are left intact without blocking pay', async () => {
  const f = await fixture();
  put(f, booking('partial', '2026-11-07T17:00:00Z'));
  put(f, booking('settled', '2026-10-25T17:00:00Z'));
  put(f, booking('old', '2026-06-26T17:00:00Z'));
  for (const [id, amount] of [['partial', 2500], ['settled', 6000], ['old', 4000]]) {
    f.DB.sqlite.prepare('INSERT INTO payroll_rental_deductions(employee_id,rental_id,amount_cents) VALUES (?,?,?)').run('rayne', id, amount);
  }
  const before = f.DB.sqlite.prepare('SELECT * FROM payroll_rental_deductions ORDER BY rental_id').all();
  const first = await paymentAccounts(f.DB, 'rayne', now);
  assert.equal(first.accounts[0].rentalBalanceCents, 3500);
  assert.equal(first.accounts[0].reviewCount, 0);
  assert.equal(first.rentalCharges.find(c => c.rentalId === 'partial').appliedCents, 2500);
  assert.equal(first.rentalCharges.find(c => c.rentalId === 'settled').outstandingCents, 0);
  assert.deepEqual(await paymentAccounts(f.DB, 'rayne', now), first);
  assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM payroll_rental_deductions ORDER BY rental_id').all(), before);
  f.close();
});

test('removed or reduced post-cutoff rentals still require review after a saved deduction', async () => {
  const f = await fixture();
  put(f, booking('reduced', '2026-11-07T17:00:00Z', { priceCents: 1000 }));
  for (const id of ['removed', 'reduced']) f.DB.sqlite.prepare('INSERT INTO payroll_rental_deductions(employee_id,rental_id,amount_cents) VALUES (?,?,?)').run('rayne', id, 2500);
  const state = await paymentAccounts(f.DB, 'rayne', now);
  assert.equal(state.accounts[0].reviewCount, 2);
  assert.equal(state.accounts[0].rentalBalanceCents, 0);
  f.close();
});

test('renter matching uses a unique exact customer name or known email, never crew or a name in notes', () => {
  const config = { timeZone: 'America/New_York', importStart: '2026-01-01T00:00:00Z', commissionRate: .3,
    owner: { name: 'Studio' }, employees: [{ id: 'rayne', name: 'Rayne', email: 'r@example.invalid' }, { id: 'jordyn', name: 'Jordyn', email: 'j@example.invalid' }] };
  const event = { id: 'own', summary: '  RAYNE  : Studio A Rental', description: 'Price: $60\nEmail: different@example.invalid',
    start: { dateTime: '2026-11-07T17:00:00Z' }, end: { dateTime: '2026-11-07T18:00:00Z' }, attendees: [{ email: 'jordyn@example.invalid', responseStatus: 'accepted' }] };
  const renter = (patch, employees = config.employees) => buildDashboardPayloads({ calendarEvents: [{ ...event, ...patch }], config: { ...config, employees }, ledger: { employees: {} }, overrides: { events: {} }, source: 'sample' }).owner.rentals[0].teamRenterId;
  assert.equal(renter({}), 'rayne');
  assert.equal(renter({ description: 'Name: Jordyn\nPrice: $60' }), 'jordyn');
  assert.equal(renter({ description: 'Name: Rayne\nEmail: j@example.invalid\nPrice: $60' }), 'jordyn');
  assert.equal(renter({ summary: 'Rayne Otherperson: Studio A Rental' }), undefined);
  assert.equal(renter({ summary: 'Client: Studio A Rental', description: 'Price: $60\nAssistant: Rayne' }), undefined);
  assert.equal(renter({ summary: 'Rayne: Portrait Session' }), undefined);
  assert.equal(renter({ start: { dateTime: '2026-09-24T17:00:00Z' }, end: { dateTime: '2026-09-24T18:00:00Z' } }), undefined);
  assert.equal(renter({}, [...config.employees, { id: 'another-rayne', name: 'Rayne' }]), undefined);
});
