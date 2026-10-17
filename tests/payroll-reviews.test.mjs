import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/notification-fixture.mjs';
import { scopedPayroll } from '../lib/payroll-advances.mjs';

const date = '2026-10-10T15:00:00.000Z';
async function setup(t) {
  const f = await fixture(); t.after(() => f.close());
  f.DB.sqlite.prepare('UPDATE payroll_state SET generation = ?, synced_at = ? WHERE id = 1').run('current', date);
  f.DB.sqlite.prepare('UPDATE team_state SET generation = ? WHERE id = 1').run('current');
  f.DB.sqlite.prepare('INSERT INTO payroll_advances VALUES (?, ?, ?, ?, ?)').run('advance', 'akiva', 10000, date, 'unpaid-and-future');
  return f;
}
function credit(f, id, amount, kind = 'rental', cash = 0) {
  f.DB.sqlite.prepare('INSERT INTO payroll_advance_allocations VALUES (?, ?, ?, ?, ?, ?)').run('advance', kind, id, amount, cash, date);
}
function rental(f, id, amount, eligible = 1, generation = 'current') {
  f.DB.sqlite.prepare('INSERT INTO payroll_rental_earnings VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(generation, 'akiva', id, amount, 0, date, eligible, date);
}
function appointment(f, id, generation = 'current') {
  f.DB.sqlite.prepare('INSERT INTO team_appointments VALUES (?, ?, ?)').run(generation, id, JSON.stringify({id,title:'Studio A Rental',customer:'Synthetic Customer',start:date,end:'2026-10-10T16:00:00.000Z'}));
}
function task(f, id, status, amount = 4000, person = 'akiva') {
  f.DB.sqlite.prepare('INSERT INTO team_creative_assignments VALUES (?, ?, ?, ?, ?)').run(id, person, 1, '', JSON.stringify({id,title:'Synthetic edit',employeeId:person,status,amountCents:amount,payments:[],dueAt:date,approvedAt:status === 'approved' ? date : null}));
}
const read = async f => { const result = await f.call('owner', '/payroll/reviews'); assert.equal(result.status, 200); return result.data.reviews; };

test('advance review identifies the person, rental, current earning and saved credit without writes', async t => {
  const f = await setup(t); credit(f, 'rental-a', 2500); rental(f, 'rental-a', 1500); appointment(f, 'rental-a');
  const before = f.DB.sqlite.prepare('SELECT total_changes() AS n').get().n;
  const [item] = await read(f);
  assert.equal(item.employeeId, 'akiva'); assert.equal(item.title, 'Studio A Rental'); assert.equal(item.customer, 'Synthetic Customer');
  assert.equal(item.appliedCents, 2500); assert.equal(item.currentAmountCents, 1500); assert.equal(item.code, 'earning_reduced');
  assert.equal(item.sourceId, 'rental-a'); assert.equal(item.sourceAvailable, true); assert.equal(item.start, date);
  assert.equal(f.DB.sqlite.prepare('SELECT total_changes() AS n').get().n, before);
  const summary = (await f.call('owner', '/payroll')).data;
  assert.equal(summary.reviewCount, 1); assert.deepEqual(summary.reviewPeople, [{employeeId:'akiva',count:1}]);
  assert.deepEqual(scopedPayroll(summary, 'rayne').reviewPeople, []);
  assert.deepEqual(scopedPayroll(summary, 'rayne').allocations, []);
});

test('reviews distinguish ineligible rentals, absent earnings, and prior cash exceeding the current earning', async t => {
  const f = await setup(t);
  credit(f, 'ineligible', 1500); rental(f, 'ineligible', 2000, 0); appointment(f, 'ineligible');
  credit(f, 'missing-earning', 1000); appointment(f, 'missing-earning');
  credit(f, 'cash-overlap', 1000, 'rental', 1000); rental(f, 'cash-overlap', 1500); appointment(f, 'cash-overlap');
  const reviews = await read(f), byId = id => reviews.find(row => row.sourceId === id);
  assert.equal(byId('ineligible').code, 'rental_ineligible'); assert.equal(byId('ineligible').currentAmountCents, 2000);
  assert.equal(byId('missing-earning').code, 'rental_missing'); assert.equal(byId('missing-earning').sourceAvailable, true);
  assert.equal(byId('missing-earning').currentAmountCents, null);
  assert.equal(byId('cash-overlap').cashFloorCents, 1000); assert.equal(byId('cash-overlap').code, 'earning_reduced');
});

test('removed sources retain an honest reference without inventing historical details or joining stale imports', async t => {
  const f = await setup(t); credit(f, 'removed-rental', 1200); rental(f, 'removed-rental', 2500, 1, 'old'); appointment(f, 'removed-rental', 'old');
  const [item] = await read(f);
  assert.equal(item.sourceId, 'removed-rental'); assert.equal(item.sourceAvailable, false);
  assert.equal(item.customer, null); assert.equal(item.start, null); assert.equal(item.end, null);
  assert.equal(item.currentAmountCents, null); assert.equal(item.creditedAt, date);
  assert.equal(item.title, 'Rental earning'); assert.equal(item.code, 'rental_missing');
});

test('creative reviews describe approval, reassignment, missing tasks and reduced pay accurately', async t => {
  const f = await setup(t);
  for (const id of ['unapproved', 'reassigned', 'missing', 'reduced']) credit(f, id, 1000, 'creative');
  task(f, 'unapproved', 'revision'); task(f, 'reassigned', 'approved', 4000, 'rayne'); task(f, 'reduced', 'approved', 500);
  const rows = await read(f), byId = id => rows.find(row => row.sourceId === id);
  assert.equal(byId('unapproved').code, 'task_unapproved'); assert.equal(byId('unapproved').sourceAvailable, true);
  assert.equal(byId('reassigned').code, 'task_reassigned'); assert.equal(byId('reassigned').currentAmountCents, null);
  assert.equal(byId('missing').code, 'task_missing'); assert.equal(byId('missing').sourceAvailable, false);
  assert.equal(byId('reduced').code, 'earning_reduced'); assert.equal(byId('reduced').currentAmountCents, 500);
  assert.ok(rows.every(row => row.employeeId === 'akiva' && row.kind === 'creative'));
});

test('only the owner can read reviews, mutation requests fail, and restored sources clear the review', async t => {
  const f = await setup(t); credit(f, 'restored', 1200);
  for (const user of ['akiva', 'jordyn', 'rayne', 'sync']) assert.equal((await f.call(user, '/payroll/reviews')).status, 403);
  for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal((await f.call('owner', '/payroll/reviews', {}, method)).status, 405);
  assert.equal((await read(f)).length, 1);
  const before = f.DB.sqlite.prepare('SELECT amount_cents FROM payroll_advance_allocations').get().amount_cents;
  rental(f, 'restored', 1200);
  assert.equal((await read(f)).length, 0);
  assert.equal(f.DB.sqlite.prepare('SELECT amount_cents FROM payroll_advance_allocations').get().amount_cents, before);
});
