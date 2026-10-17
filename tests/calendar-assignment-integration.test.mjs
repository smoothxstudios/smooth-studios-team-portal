import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture } from './helpers/notification-fixture.mjs';
import { calendarDeliveryStatus } from '../lib/calendar-delivery-status.mjs';

const appointment = { id: 'synthetic-calendar-event', title: 'Studio A Rental', customer: 'Synthetic Customer', priceCents: 5000,
  start: '2026-12-20T14:00:00.000Z', end: '2026-12-20T15:00:00.000Z', acceptedEmployeeIds: [] };
const configuration = { calendarId: 'synthetic-calendar@example.invalid', employees: [
  { id: 'jordyn', email: 'synthetic-jordyn@example.invalid', invitationEmails: ['synthetic-jordyn@example.invalid', 'synthetic-alias@example.invalid'] },
  { id: 'rayne', email: 'synthetic-rayne@example.invalid', invitationEmails: ['synthetic-rayne@example.invalid'] },
] };
async function setup() {
  const f = await fixture(); delete f.env.VAPID_JWK;
  const generation = crypto.randomUUID();
  assert.equal((await f.call('sync', '/sync/import', { generation, appointments: [appointment] })).status, 200);
  assert.equal((await f.call('sync', '/sync/commit', { generation, count: 1 })).status, 200);
  return f;
}
async function offer(f, employeeId = 'jordyn', extra = {}) {
  const schedule = (await f.call('owner', '/schedule')).data;
  return f.call('owner', '/assignments', { employeeId, appointmentId: appointment.id, revision: schedule.revision, instructions: '', ...extra });
}
async function finish(f) { await Promise.allSettled(f.pending); f.close(); }

test('Calendar delivery configuration is sync-only and never leaks employee addresses through schedule', async () => {
  const f = await setup();
  try {
    assert.equal((await f.call('owner', '/sync/calendar/configuration', configuration)).status, 403);
    assert.equal((await f.call('jordyn', '/sync/calendar/configuration', configuration)).status, 403);
    assert.equal((await f.call('sync', '/sync/calendar/configuration', configuration)).status, 200);
    const stored = JSON.parse(f.DB.sqlite.prepare('SELECT data FROM calendar_sync_config WHERE id = 1').get().data);
    assert.deepEqual(stored, configuration);
    for (const id of ['owner', 'jordyn', 'rayne']) assert.equal(JSON.stringify((await f.call(id, '/schedule')).data).includes('@example.invalid'), false);
    const duplicate = { ...configuration, employees: [configuration.employees[0], { ...configuration.employees[1], invitationEmails: configuration.employees[0].invitationEmails, email: configuration.employees[0].email }] };
    assert.equal((await f.call('sync', '/sync/calendar/configuration', duplicate)).status, 400);
    assert.equal((await f.call('sync', '/sync/calendar/configuration', { ...configuration, calendarId: 'https://untrusted.invalid/path' })).status, 400);
  } finally { await finish(f); }
});

test('only new Calendar assignment mutations queue durable work and failed saves queue nothing', async () => {
  const f = await setup();
  try {
    const old = { id: 'older-unreplayed-offer', employeeId: 'rayne', appointmentId: appointment.id, title: appointment.title,
      start: appointment.start, end: appointment.end, status: 'pending', createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-01T12:00:00Z' };
    f.DB.sqlite.prepare('INSERT INTO team_assignments(id,employee_id,data) VALUES(?,?,?)').run(old.id, old.employeeId, JSON.stringify(old));
    await f.call('owner', '/schedule');
    assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS count FROM calendar_assignment_outbox').get().count, 0);
    assert.equal((await offer(f, 'jordyn', { revision: -1 })).status, 409);
    assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS count FROM calendar_assignment_outbox').get().count, 0);
    assert.equal((await offer(f)).status, 200);
    const row = f.DB.sqlite.prepare('SELECT * FROM calendar_assignment_outbox').get();
    assert.ok(row.version); assert.notEqual(row.assignment_id, old.id);
    assert.equal((await offer(f)).status, 409);
    assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS count FROM calendar_assignment_outbox').get().count, 1);
    const current = (await f.call('jordyn', '/schedule')).data;
    assert.equal((await f.call('jordyn', `/assignments/${row.assignment_id}`, { revision: current.revision, status: 'accepted' })).status, 200);
    const accepted = f.DB.sqlite.prepare('SELECT * FROM calendar_assignment_outbox WHERE assignment_id = ?').get(row.assignment_id);
    assert.notEqual(accepted.version, row.version);
    assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS count FROM calendar_assignment_outbox').get().count, 1);
  } finally { await finish(f); }
});

test('Calendar sync status follows only its employee and custom work creates no invitation', async () => {
  const f = await setup();
  try {
    assert.equal((await offer(f)).status, 200);
    await Promise.allSettled(f.pending);
    const mine = (await f.call('jordyn', '/schedule')).data.assignments;
    assert.equal(mine.length, 1); assert.equal(mine[0].calendarSync.status, 'needs_connection');
    assert.equal((await f.call('rayne', '/schedule')).data.assignments.length, 0);
    assert.equal((await f.call('owner', '/schedule')).data.assignments[0].calendarSync.status, 'needs_connection');
    const before = (await f.call('owner', '/schedule')).data;
    const custom = await f.call('owner', '/assignments', { revision: before.revision, employeeId: 'rayne', title: 'Synthetic studio task',
      startLocal: '2026-12-21T10:00', endLocal: '2026-12-21T11:00', instructions: '' });
    assert.equal(custom.status, 200);
    assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS count FROM calendar_assignment_outbox').get().count, 1);
  } finally { await finish(f); }
});

test('an accepted app response alone never becomes a native Google confirmation', () => {
  assert.equal(calendarDeliveryStatus(undefined), null);
  for (const status of ['pending', 'retrying', 'needs_connection', 'needs_review', 'stale']) {
    assert.equal(calendarDeliveryStatus({ status, googleStatus: 'accepted' }).accepted, false);
  }
  assert.equal(calendarDeliveryStatus({ status: 'synced', googleStatus: 'needsAction' }).accepted, false);
  assert.equal(calendarDeliveryStatus({ status: 'synced', googleStatus: 'accepted' }).accepted, true);
});

test('Calendar reschedules invalidate existing delivery versions without replaying legacy offers', async () => {
  const f = await setup();
  try {
    assert.equal((await offer(f)).status, 200);
    await Promise.allSettled(f.pending);
    const row = f.DB.sqlite.prepare('SELECT * FROM calendar_assignment_outbox').get();
    f.DB.sqlite.prepare("UPDATE calendar_assignment_outbox SET status = 'synced', result = ? WHERE assignment_id = ?")
      .run(JSON.stringify({ code: 'response_confirmed', googleStatus: 'accepted' }), row.assignment_id);
    const old = { id: 'legacy-without-delivery', employeeId: 'rayne', appointmentId: appointment.id, title: appointment.title,
      start: appointment.start, end: appointment.end, status: 'accepted', createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-01T12:00:00Z' };
    f.DB.sqlite.prepare('INSERT INTO team_assignments(id,employee_id,data) VALUES(?,?,?)').run(old.id, old.employeeId, JSON.stringify(old));
    const generation = crypto.randomUUID(), moved = { ...appointment, start: '2026-12-21T14:00:00.000Z', end: '2026-12-21T15:00:00.000Z' };
    assert.equal((await f.call('sync', '/sync/import', { generation, appointments: [moved] })).status, 200);
    assert.equal((await f.call('sync', '/sync/commit', { generation, count: 1 })).status, 200);
    await Promise.allSettled(f.pending);
    const fresh = f.DB.sqlite.prepare('SELECT * FROM calendar_assignment_outbox').get();
    assert.notEqual(fresh.version, row.version);
    assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS count FROM calendar_assignment_outbox').get().count, 1);
    const assignment = (await f.call('jordyn', '/schedule')).data.assignments[0];
    assert.equal(assignment.status, 'pending');
    assert.notEqual(assignment.calendarSync.googleStatus, 'accepted');
  } finally { await finish(f); }
});

test('import read time keeps an older snapshot from overriding a newer verified Google response', async () => {
  const f = await setup();
  try {
    assert.equal((await offer(f)).status, 200); await Promise.allSettled(f.pending);
    const confirmedAt = Date.now() - 1000;
    f.DB.sqlite.prepare("UPDATE calendar_assignment_outbox SET status = 'synced', result = ?, updated_at = ?")
      .run(JSON.stringify({ code: 'response_confirmed', googleStatus: 'accepted' }), confirmedAt);
    const publish = async (calendarReadAt, status) => {
      const generation = crypto.randomUUID(), event = { ...appointment, calendarInvitations: [{ employeeId: 'jordyn', status }] };
      assert.equal((await f.call('sync', '/sync/import', { generation, appointments: [event] })).status, 200);
      assert.equal((await f.call('sync', '/sync/commit', { generation, count: 1, calendarReadAt })).status, 200);
      return (await f.call('jordyn', '/schedule')).data.assignments[0].calendarSync;
    };
    assert.equal((await publish(new Date(confirmedAt - 5000).toISOString(), 'needsAction')).googleStatus, 'accepted');
    assert.equal((await publish(new Date(confirmedAt + 500).toISOString(), 'declined')).googleStatus, 'declined');
    assert.equal((await f.call('sync', '/sync/commit', { generation: 'invalid-time', count: 0, calendarReadAt: 'not-a-date' })).status, 400);
  } finally { await finish(f); }
});
