import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/notification-fixture.mjs';
import { creativeEarnings, creativeOwed, creativePaid, creativeEarningDate } from '../lib/creative-work.mjs';

const input = extra => ({id: crypto.randomUUID(), employeeId: 'jordyn', category: 'training', workDate: '2025-09-12', amountCents: 8000, paymentStatus: 'owed', ...extra});
async function setup(t) { const f = await fixture(); delete f.env.VAPID_JWK; t.after(() => f.close()); return f; }
const add = (f, data) => f.call('owner', '/creative-work/manual-pay', data);
const act = (f, user, item, action, extra = {}) => f.call(user, `/creative-work/${item.id}`, {action, version: item.version, ...extra}, 'PATCH');
test('only the owner can add pay; each employee can read only their own entries', async t => {
  const f = await setup(t);
  for (const user of ['jordyn', 'rayne', 'sync']) assert.equal((await f.call(user, '/creative-work/manual-pay', input())).status, 403);
  assert.equal((await f.call('owner', '/creative-work/manual-pay')).status, 405);
  const result = await add(f, input()); assert.equal(result.status, 200);
  const item = result.data.assignment;
  assert.equal(item.status, 'approved'); assert.equal(item.entryType, 'manual');
  assert.equal((await f.call('jordyn', '/creative-work')).data.assignments.length, 1);
  assert.deepEqual((await f.call('rayne', '/creative-work')).data.assignments, []);
  assert.equal((await act(f, 'rayne', item, 'pay', {amountCents: 1})).status, 404);
  assert.equal((await act(f, 'jordyn', item, 'submit', {links: []})).status, 409);
  assert.equal((await act(f, 'jordyn', item, 'accept')).status, 409);
  assert.deepEqual((await f.call('sync', '/sync/accepted')).data.assignments, []);
});
test('manual earnings use the work date and preserve separate actual recording and payment dates', async t => {
  const f = await setup(t);
  const owed = (await add(f, input())).data.assignment;
  assert.equal(creativeEarningDate(owed), '2025-09-12T04:00:00.000Z');
  assert.notEqual(owed.approvedAt, owed.earnedAt);
  assert.deepEqual(creativeEarnings([owed], 2025).metrics, {paid: 0, owed: 8000, projected: 0});
  assert.equal(creativeEarnings([owed], 2026).metrics.owed, 0);
  const paid = (await add(f, input({category: 'onboarding', paymentStatus: 'paid', paidDate: '2025-09-13', method: 'Synthetic cash'}))).data.assignment;
  assert.equal(creativePaid(paid), 8000); assert.equal(creativeOwed(paid), 0);
  assert.equal(paid.payments[0].paidAt, '2025-09-13T04:00:00.000Z');
  assert.equal(paid.payments[0].method, 'Synthetic cash');
  assert.notEqual(paid.payments[0].recordedAt, paid.payments[0].paidAt);
  const alerts = f.DB.sqlite.prepare('SELECT payload FROM team_notification_events').all().map(row => JSON.parse(row.payload));
  assert.ok(alerts.every(a => a.target === 'payouts' && a.personId === 'jordyn'));
});
test('empty, inactive, invalid and future fields cannot create a pay entry', async t => {
  const f = await setup(t);
  const hashes = JSON.parse(f.env.TEAM_TOKEN_HASHES); delete hashes.amia; f.env.TEAM_TOKEN_HASHES = JSON.stringify(hashes);
  for (const invalid of [{employeeId: ''}, {employeeId: 'owner'}, {employeeId: 'amia'}, {category: ''}, {category: 'other', title: ' '}, {paymentStatus: ''}, {amountCents: 0}, {amountCents: 1.5}, {amountCents: 10_000_001}, {workDate: '2025-02-30'}, {workDate: '2099-01-01'}, {paymentStatus: 'paid'}, {paymentStatus: 'paid', paidDate: '2099-01-01'}, {note: 'a'.repeat(4001)}]) {
    assert.equal((await add(f, input(invalid))).status, 400, JSON.stringify(invalid));
  }
  assert.equal((await f.call('owner', '/creative-work')).data.assignments.length, 0);
});
test('retries and simultaneous saves record one earning and alert; changed retries require review', async t => {
  const f = await setup(t), data = input({category: 'other', title: 'Synthetic studio setup'});
  const results = await Promise.all([add(f, data), add(f, data)]);
  assert.ok(results.every(r => r.status === 200));
  assert.equal((await add(f, data)).data.duplicate, true);
  assert.equal((await add(f, {...data, amountCents: 9000})).status, 409);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM team_creative_assignments').get().n, 1);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM team_notification_events').get().n, 1);
});
test('manual pay uses existing partial-payment, ownership, stale-version and overpayment safeguards', async t => {
  const f = await setup(t); let item = (await add(f, input())).data.assignment;
  assert.equal((await act(f, 'jordyn', item, 'pay', {amountCents: 8000})).status, 403);
  assert.equal((await act(f, 'owner', item, 'pay', {amountCents: 8001})).status, 400);
  const old = item;
  item = (await act(f, 'owner', item, 'pay', {amountCents: 3000})).data.assignment;
  assert.equal(creativeOwed(item), 5000);
  assert.equal((await act(f, 'owner', old, 'pay', {amountCents: 3000})).status, 409);
  item = (await act(f, 'owner', item, 'pay', {amountCents: 5000})).data.assignment;
  assert.equal(creativeOwed(item), 0); assert.equal(creativePaid(item), 8000);
});
test('Akiva advance credit affects only Akiva unpaid earnings, never another person or cash already paid', async t => {
  const f = await setup(t);
  f.DB.sqlite.prepare('INSERT INTO payroll_advances VALUES (?, ?, ?, ?, ?)').run('synthetic-advance', 'akiva', 5000, '2025-01-01T00:00:00Z', 'unpaid-and-future');
  const paid = (await add(f, input({employeeId: 'akiva', paymentStatus: 'paid', paidDate: '2025-09-13'}))).data.assignment;
  assert.equal(paid.advanceAppliedCents ?? 0, 0);
  const other = (await add(f, input())).data.assignment;
  assert.equal(other.advanceAppliedCents ?? 0, 0); assert.equal(creativeOwed(other), 8000);
  const akiva = (await add(f, input({employeeId: 'akiva'}))).data.assignment;
  assert.equal(akiva.advanceAppliedCents, 5000); assert.equal(creativeOwed(akiva), 3000);
});
