import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/notification-fixture.mjs';
import { calendarRecord, calendarKey, payrollRecord, payrollKey, recordManifest, recordDelta } from '../lib/sync-records.mjs';
import { syncRecords } from '../scripts/lib/incremental-sync.mjs';

const rental = (id, extra = {}) => calendarRecord({ id, title: 'Studio A Rental', customer: 'Synthetic customer',
  start: '2026-01-02T15:00:00Z', end: '2026-01-02T16:00:00Z', priceCents: 5000, acceptedEmployeeIds: [], ...extra });
const earning = (id, extra = {}) => payrollRecord({ employeeId: 'akiva', rentalId: id, amountCents: 1500,
  paidCents: 0, earnedAt: '2026-01-02T16:00:00Z', eligible: true, ...extra });
async function setup() {
  const f = await fixture(); delete f.env.VAPID_JWK;
  f.sequence = 0;
  f.request = async (path, data) => {
    const r = await f.call('sync', path, data);
    if (r.status !== 200) throw Object.assign(new Error(JSON.stringify(r)), { status: r.status });
    return r.data;
  };
  f.time = () => new Date(Date.now() + ++f.sequence).toISOString();
  f.calendar = rows => syncRecords({ request: f.request, prefix: '/sync', records: rows, key: calendarKey,
    field: 'appointments', time: { calendarReadAt: f.time() } });
  f.payroll = rows => syncRecords({ request: f.request, prefix: '/sync/payroll', records: rows, key: payrollKey,
    field: 'earnings', time: { asOf: f.time() } });
  f.writes = () => f.DB.sqlite.prepare('SELECT total_changes() AS n').get().n;
  f.rentals = () => f.DB.sqlite.prepare('SELECT rowid, * FROM team_appointments WHERE generation = (SELECT generation FROM team_state WHERE id = 1)').all();
  f.earnings = () => f.DB.sqlite.prepare('SELECT rowid, * FROM payroll_rental_earnings WHERE generation = (SELECT generation FROM payroll_state WHERE id = 1)').all();
  return f;
}

test('five-minute no-change imports preserve historical rows and write only three sync-state updates', async () => {
  const f = await setup();
  const rentals = Array.from({ length: 240 }, (_, i) => rental(`historic-${i}`));
  const earnings = rentals.map(r => earning(r.id));
  // Upgrade an existing database without copying its active history.
  const oldGeneration = crypto.randomUUID(), oldTime = new Date(Date.now() - 1000).toISOString();
  for (let i = 0; i < rentals.length; i += 50) await f.request('/sync/import', { generation: oldGeneration, appointments: rentals.slice(i, i + 50) });
  await f.request('/sync/commit', { generation: oldGeneration, count: rentals.length, calendarReadAt: oldTime });
  for (let i = 0; i < earnings.length; i += 50) await f.request('/sync/payroll/import', { generation: oldGeneration, asOf: oldTime, earnings: earnings.slice(i, i + 50) });
  await f.request('/sync/payroll/commit', { generation: oldGeneration, count: earnings.length, asOf: oldTime });
  const beforeRentals = f.rentals(), beforeEarnings = f.earnings(), before = f.writes();
  assert.deepEqual((await f.calendar([...rentals].reverse())).syncStats, { inserted: 0, updated: 0, removed: 0, unchanged: 240 });
  assert.deepEqual((await f.payroll([...earnings].reverse())).syncStats, { inserted: 0, updated: 0, removed: 0, unchanged: 240 });
  assert.equal(f.writes() - before, 3, 'no records or indexes need to be recreated when only freshness changes');
  assert.deepEqual(f.rentals(), beforeRentals);
  assert.deepEqual(f.earnings(), beforeEarnings);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_imports').get().n, 0);
  const config = { calendarId: 'synthetic-calendar', employees: [{ id: 'akiva', email: 'akiva@example.invalid', invitationEmails: ['akiva@example.invalid'] }] };
  await f.request('/sync/calendar/configuration', config);
  const beforeConfig = f.writes(); await f.request('/sync/calendar/configuration', config);
  assert.equal(f.writes(), beforeConfig, 'unchanged Calendar delivery settings are read-only');
});

test('only changed rentals and earnings are written; untouched history retains identity', async () => {
  const f = await setup(), old = [rental('keep'), rental('extend'), rental('remove')];
  await f.calendar(old); await f.payroll(old.map(r => earning(r.id)));
  const untouched = f.rentals().find(r => r.id === 'keep'), untouchedPay = f.earnings().find(r => r.rental_id === 'keep');
  const next = [old[0], rental('extend', { end: '2026-01-02T16:30:00Z', priceCents: 7500 }), rental('new')];
  const stats = { inserted: 1, updated: 1, removed: 1, unchanged: 1 };
  assert.deepEqual((await f.calendar(next)).syncStats, stats);
  assert.deepEqual((await f.payroll([earning('keep'), earning('extend', { amountCents: 2250 }), earning('new')])).syncStats, stats);
  assert.deepEqual(f.rentals().find(r => r.id === 'keep'), untouched);
  assert.deepEqual(f.earnings().find(r => r.rental_id === 'keep'), untouchedPay);
  assert.deepEqual(f.rentals().map(r => r.id).sort(), ['extend', 'keep', 'new']);
  assert.equal(f.earnings().find(r => r.rental_id === 'extend').amount_cents, 2250);
});

test('partial and corrupted imports never publish; stale snapshots cannot overwrite newer data', async () => {
  const f = await setup(); await f.calendar([rental('saved')]);
  const manifest = await f.request('/sync/manifest'), generation = crypto.randomUUID();
  const desired = [rental('saved'), rental('added'), rental('missing-chunk')];
  const wanted = await recordManifest(desired, calendarKey);
  const input = { incremental: true, generation, baseGeneration: manifest.generation, baseSyncedAt: manifest.syncedAt,
    calendarReadAt: f.time(), hash: wanted.hash, count: 3, changedCount: 2, removed: [] };
  await f.request('/sync/import', { incremental: true, generation, appointments: [desired[1]] });
  const before = f.rentals();
  assert.equal((await f.call('sync', '/sync/commit', input)).status, 409);
  assert.deepEqual(f.rentals(), before);
  assert.equal((await f.call('sync', '/sync/commit', { ...input, changedCount: 1 })).status, 409, 'full-content hash catches a missing record');
  await f.calendar([rental('saved', { priceCents: 6500 })]);
  await f.request('/sync/import', { incremental: true, generation, appointments: [desired[2]] });
  assert.equal((await f.call('sync', '/sync/commit', input)).status, 409);
  assert.equal(JSON.parse(f.rentals()[0].data).priceCents, 6500);
  // Manifest and staging data are never exposed to employees or the owner token.
  for (const user of ['owner', 'akiva', 'jordyn', 'rayne']) {
    assert.equal((await f.call(user, '/sync/manifest')).status, 403);
    assert.equal((await f.call(user, '/sync/payroll/manifest')).status, 403);
  }
});

test('duration edits retain acceptance, while real removals cancel only the removed assignment', async () => {
  const f = await setup(); await f.calendar([rental('extend'), rental('remove')]);
  for (const id of ['extend', 'remove']) {
    const item = { id: `offer-${id}`, employeeId: 'akiva', appointmentId: id, title: 'Studio A Rental',
      start: rental(id).start, end: rental(id).end, status: 'accepted', createdAt: '2026-01-01T12:00:00Z', updatedAt: '2026-01-01T12:00:00Z' };
    f.DB.sqlite.prepare('INSERT INTO team_assignments(id,employee_id,data) VALUES (?,?,?)').run(item.id, item.employeeId, JSON.stringify(item));
  }
  await f.calendar([rental('extend', { end: '2026-01-02T17:00:00Z' })]);
  const items = f.DB.sqlite.prepare('SELECT data FROM team_assignments').all().map(r => JSON.parse(r.data));
  assert.equal(items.find(r => r.appointmentId === 'extend').status, 'accepted');
  assert.equal(items.find(r => r.appointmentId === 'extend').end, '2026-01-02T17:00:00.000Z');
  assert.equal(items.find(r => r.appointmentId === 'remove').status, 'cancelled');
});

test('eligibility, payment corrections and deleted earnings preserve Akiva advance allocations without double deductions', async () => {
  const f = await setup();
  f.DB.sqlite.prepare('INSERT INTO payroll_advances(id,employee_id,amount_cents,created_at,basis) VALUES (?,?,?,?,?)')
    .run('synthetic-advance', 'akiva', 5000, '2026-01-01T12:00:00Z', 'unpaid-and-future');
  const rows = [earning('a'), earning('b', { eligible: false }), earning('c', { employeeId: 'jordyn' })];
  const first = await f.payroll(rows);
  assert.equal(first.balances[0].appliedCents, 1500);
  const next = await f.payroll([rows[0], earning('b'), rows[2]]);
  assert.equal(next.balances[0].appliedCents, 3000);
  const again = await f.payroll([rows[0], earning('b'), rows[2]]);
  assert.equal(again.balances[0].appliedCents, 3000);
  assert.ok(again.allocations.every(a => a.employeeId === 'akiva'));
  const corrected = await f.payroll([earning('a', { paidCents: 1500 }), earning('b'), rows[2]]);
  assert.equal(corrected.balances[0].appliedCents, 3000);
  const removed = await f.payroll([earning('a', { paidCents: 1500 }), rows[2]]);
  assert.equal(removed.balances[0].appliedCents, 3000);
  assert.equal(removed.reviewCount, 1, 'missing previously credited work needs review, not a refunded advance');
});

test('payroll commit is atomic when another sync wins between verification and writing', async () => {
  const f = await setup(); await f.payroll([earning('saved')]);
  const saved = await f.request('/sync/payroll/manifest'), generation = crypto.randomUUID(), asOf = f.time();
  const records = [earning('saved', { amountCents: 2500 })], wanted = await recordManifest(records, payrollKey);
  await f.request('/sync/payroll/import', { incremental: true, generation, asOf, earnings: records });
  const before = f.earnings(), originalBatch = f.DB.batch.bind(f.DB);
  f.DB.batch = async statements => {
    f.DB.sqlite.prepare('UPDATE payroll_state SET synced_at = ?, mutation = ? WHERE id = 1').run(f.time(), 'other-sync');
    return originalBatch(statements);
  };
  const result = await f.call('sync', '/sync/payroll/commit', { incremental: true, generation, asOf,
    baseGeneration: saved.generation, baseSyncedAt: saved.syncedAt, changedCount: 1, removed: [], count: 1, hash: wanted.hash });
  assert.equal(result.status, 409); assert.deepEqual(f.earnings(), before);
});

test('empty verified snapshots remove the right records and abandoned imports expire safely', async () => {
  const f = await setup(); await f.calendar([rental('old')]); await f.payroll([earning('old')]);
  assert.equal((await f.calendar([])).syncStats.removed, 1);
  assert.equal((await f.payroll([])).syncStats.removed, 1);
  assert.deepEqual(f.rentals(), []); assert.deepEqual(f.earnings(), []);
  const generation = crypto.randomUUID();
  await f.request('/sync/import', { incremental: true, generation, appointments: [rental('abandoned')] });
  f.DB.sqlite.prepare('UPDATE sync_imports SET created_at = ? WHERE generation = ?').run(Date.now() - 2 * 86400_000, generation);
  await f.request('/sync/manifest');
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM team_appointments').get().n, 0);
});

test('normalization avoids rewrites for equivalent timestamps and reordered guest responses', async () => {
  const a = rental('same', { acceptedEmployeeIds: ['rayne', 'akiva'], calendarInvitations: [{ employeeId: 'rayne', status: 'accepted' }, { employeeId: 'akiva', status: 'needsAction' }] });
  const b = rental('same', { start: '2026-01-02T10:00:00-05:00', acceptedEmployeeIds: ['akiva', 'rayne'], calendarInvitations: [...a.calendarInvitations].reverse() });
  const desired = await recordManifest([a], calendarKey), saved = await recordManifest([b], calendarKey);
  assert.deepEqual(recordDelta([a], desired, saved, calendarKey), { changed: [], removed: [] });
  await assert.rejects(recordManifest([a, a], calendarKey), /Duplicate/);
});
