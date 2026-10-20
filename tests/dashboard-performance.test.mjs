import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../team-api/worker.mjs';
import { fixture } from './helpers/notification-fixture.mjs';
import { teamToken, tokenHash } from '../lib/team-auth.mjs';
import { encryptDashboard, decryptPayload } from '../scripts/lib/dashboard-data.mjs';
import { homeDashboard, expandHomeLedger } from '../lib/dashboard-history.mjs';
import { ownerPeriodFinances, recognizedRevenue } from '../lib/owner-finances.mjs';
import { teamEarnings, weeklyTeamHours } from '../lib/team-summary.mjs';
import { employeeEarningsForYear } from '../lib/employee-home.mjs';
import { openDashboardSession, openTeamSession, sessionFetch, closeTeamSession } from '../lib/team-session.mjs';

const generatedAt = '2026-10-20T14:00:00Z', password = 'synthetic-notification-tests-owner';
const employees = [{ id: 'jordyn' }];
const payload = { role: 'owner', user: { id: 'owner' }, generatedAt, employees,
  rentals: Array.from({ length: 90 }, (_, i) => ({ id: `r${i}`, title: 'Studio Rental', customer: `Synthetic client ${i}`,
    start: new Date(Date.parse(generatedAt) - i * 86400_000).toISOString(), end: new Date(Date.parse(generatedAt) - i * 86400_000 + 3600000).toISOString(),
    rentalDetails: 'Synthetic instructions and rental description. '.repeat(60), priceCents: 5000, paidOnlineCents: i % 3 ? 5500 : null,
    fullyPaid: i % 3 !== 0, paymentOverride: i % 5 ? undefined : true, tipCents: i % 3 ? 500 : 0,
    categoryId: 'studio-rental', category: 'Studio Rental', assignedEmployeeIds: ['jordyn'],
    employeePayouts: { jordyn: { amountCents: 1500, paid: i % 2 === 0, paidAmountCents: i % 2 ? 300 : 1500 } } })),
  unmatchedStripePayments: [{ description: 'Synthetic old payment' }] };

test('Home defers old details without changing financial totals or previous-week hours', () => {
  const home = homeDashboard(payload), expanded = expandHomeLedger(home), now = Date.parse(generatedAt);
  assert.equal(home.rentals.length, 46); assert.equal(home.unmatchedStripePayments, undefined);
  assert.equal(expanded.rentals.length, payload.rentals.length);
  const total = p => p.rentals.reduce((sum, r) => sum + recognizedRevenue(r), 0);
  assert.equal(total(expanded), total(payload));
  assert.deepEqual(ownerPeriodFinances(expanded.rentals, [], now), ownerPeriodFinances(payload.rentals, [], now));
  assert.deepEqual(teamEarnings(employees, expanded.rentals, [], now), teamEarnings(employees, payload.rentals, [], now));
  assert.deepEqual(employeeEarningsForYear(expanded.rentals, 'jordyn', 2026, now).metrics, employeeEarningsForYear(payload.rentals, 'jordyn', 2026, now).metrics);
  for (const week of [0, -1, -8, -12]) assert.deepEqual(weeklyTeamHours(employees, expanded.rentals, null, now, week), weeklyTeamHours(employees, payload.rentals, null, now, week));
  assert.ok(JSON.stringify(home).length < JSON.stringify(payload).length * .65);
});

test('combined sign-in returns Home; conditional reads skip blobs and still enforce revocation and account isolation', async t => {
  const f = await fixture(); t.after(() => f.close()); delete f.env.VAPID_JWK;
  const bundle = encryptDashboard(payload, password), published = Date.now();
  f.DB.sqlite.prepare('INSERT INTO dashboard_snapshots(user_id,envelope,home_envelope,published_at) VALUES(?,?,?,?)')
    .run('owner', JSON.stringify(bundle.envelope), JSON.stringify(bundle.homeEnvelope), published);
  let calls = 0;
  const fetcher = async (url, options) => { calls++; return worker.fetch(new Request(url, options), f.env, { waitUntil() {} }); };
  const { token, dashboard } = await openDashboardSession(await teamToken(password, 'owner'), 'owner', fetcher);
  assert.equal(calls, 1); assert.equal(decryptPayload(dashboard.envelope, password).history.deferred, true);
  const sql = [], prepare = f.DB.prepare.bind(f.DB); f.DB.prepare = text => { sql.push(text); return prepare(text); };
  const cached = await sessionFetch(token, '/dashboard?view=home', { headers: { 'if-none-match': dashboard.etag } }, fetcher);
  assert.equal(cached.status, 304); assert.equal(await cached.text(), '');
  assert.ok(!sql.some(query => /SELECT.*envelope/i.test(query)), 'unchanged reads never select the large blob');
  assert.equal(cached.headers.get('cache-control'), 'no-store'); assert.equal(cached.headers.get('access-control-expose-headers'), 'ETag');
  const full = await sessionFetch(token, '/dashboard', { headers: { 'if-none-match': dashboard.etag } }, fetcher);
  assert.equal(full.status, 200); assert.equal(full.headers.get("content-type"), "application/json"); assert.equal(decryptPayload(await full.json(), password).rentals[89].customer, 'Synthetic client 89');
  const another = await openTeamSession(await teamToken('synthetic-notification-tests-jordyn', 'jordyn'), 'jordyn', fetcher);
  assert.equal((await sessionFetch(another, '/dashboard?id=owner', { headers: { 'if-none-match': dashboard.etag } }, fetcher)).status, 404);
  f.DB.sqlite.prepare('DELETE FROM dashboard_sessions WHERE token_hash=?').run(await tokenHash(token));
  assert.equal((await sessionFetch(token, '/dashboard?view=home', { headers: { 'if-none-match': dashboard.etag } }, fetcher)).status, 401);
  await closeTeamSession(another, fetcher);
});

test('shared GETs coalesce overlapping refreshes, isolate accounts and allow fresh reads after mutations', async t => {
  const f = await fixture(); t.after(() => f.close());
  const fetcher = (url, options) => worker.fetch(new Request(url, options), f.env, { waitUntil() {} });
  const owner = await openTeamSession(await teamToken(password, 'owner'), 'owner', fetcher);
  const other = await openTeamSession(await teamToken('synthetic-notification-tests-jordyn', 'jordyn'), 'jordyn', fetcher);
  const waiting = []; let reads = 0;
  const delayed = async (_url, options) => {
    if (options.method === 'PATCH') return Response.json({ saved: true });
    reads++; await new Promise(resolve => waiting.push(resolve)); return Response.json({ count: reads });
  };
  const one = sessionFetch(owner, '/schedule', {}, delayed), two = sessionFetch(owner, '/schedule', {}, delayed);
  const separate = sessionFetch(other, '/schedule', {}, delayed);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(reads, 2);
  waiting.splice(0).forEach(resolve => resolve());
  assert.deepEqual(await (await one).json(), await (await two).json()); await separate;
  const beforeWrite = sessionFetch(owner, '/schedule', {}, delayed);
  await new Promise(resolve => setImmediate(resolve));
  await sessionFetch(owner, '/assignments/one', { method: 'PATCH' }, delayed);
  const afterWrite = sessionFetch(owner, '/schedule', {}, delayed);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(reads, 4);
  waiting.splice(0).forEach(resolve => resolve()); await Promise.all([beforeWrite, afterWrite]);
  await closeTeamSession(owner, fetcher); await closeTeamSession(other, fetcher);
});

test('Home schedule omits past details while hours retains earlier weeks and employee scope', async t => {
  const f = await fixture(); delete f.env.VAPID_JWK;
  t.after(async () => { await Promise.allSettled(f.pending); f.close(); });
  const appointments = payload.rentals.slice(0, 3).map((r, index) => ({ ...r, acceptedEmployeeIds: index === 2 ? ['rayne'] : ['jordyn'], calendarInvitations: [] }));
  appointments[0].start = new Date(Date.now() + 3600000).toISOString();
  appointments[0].end = new Date(Date.now() + 7200000).toISOString();
  appointments[1].start = appointments[2].start = '2020-01-01T12:00:00Z';
  appointments[1].end = appointments[2].end = '2020-01-01T13:00:00Z';
  const generation = crypto.randomUUID();
  assert.equal((await f.call('sync', '/sync/import', { generation, appointments })).status, 200);
  assert.equal((await f.call('sync', '/sync/commit', { generation, count: 3 })).status, 200);
  const home = (await f.call('jordyn', '/schedule?view=home')).data;
  assert.equal(home.appointments.length, 1); assert.ok(home.appointments[0].rentalDetails);
  const hours = (await f.call('jordyn', '/schedule?view=hours')).data;
  assert.equal(hours.appointments.length, 2); assert.ok(hours.appointments.every(a => !a.rentalDetails && !a.customer));
  assert.ok(hours.appointments.every(a => JSON.stringify(a.acceptedEmployeeIds) === '["jordyn"]'));
  assert.equal((await f.call('owner', '/schedule?view=hours')).data.appointments.length, 3);
});

test('aborting one shared reader leaves others intact and later reads retry network failures', async t => {
  const f = await fixture(); t.after(() => f.close());
  const fetcher = (url, options) => worker.fetch(new Request(url, options), f.env, { waitUntil() {} });
  const token = await openTeamSession(await teamToken(password, 'owner'), 'owner', fetcher);
  const controller = new AbortController(); let resolve, reads = 0;
  const delayed = async () => { reads++; await new Promise(done => { resolve = done; }); return Response.json({ ok: true }); };
  const already = new AbortController(); already.abort();
  await assert.rejects(sessionFetch(token, '/schedule', { signal: already.signal }, delayed)); assert.equal(reads, 0);
  const aborted = sessionFetch(token, '/schedule', { signal: controller.signal }, delayed);
  const kept = sessionFetch(token, '/schedule', {}, delayed);
  await new Promise(done => setImmediate(done)); controller.abort(); await assert.rejects(aborted);
  resolve(); assert.equal((await (await kept).json()).ok, true); assert.equal(reads, 1);
  await assert.rejects(sessionFetch(token, '/schedule', {}, async () => { throw new Error('Offline'); }), /Offline/);
  assert.equal((await (await sessionFetch(token, '/identity', {}, fetcher)).json()).user.id, 'owner');
  await closeTeamSession(token, fetcher);
});
