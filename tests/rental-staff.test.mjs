import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture } from './helpers/notification-fixture.mjs';
import { rentalStaffRemovals, withoutRemovedRentalStaff } from '../lib/rental-staff.mjs';

const booking = { id: 'synthetic-removal-event', title: 'Studio A Rental', customer: 'Synthetic', priceCents: 0,
  start: new Date(Date.now() + 172800000).toISOString(), end: new Date(Date.now() + 176400000).toISOString(),
  acceptedEmployeeIds: [], calendarInvitations: [{ employeeId: 'rayne', status: 'needsAction' }, { employeeId: 'jordyn', status: 'accepted' }] };
async function setup(t, appointment = booking) {
  const f = await fixture(); delete f.env.VAPID_JWK;
  t.after(async () => { await Promise.allSettled(f.pending); f.close(); });
  const generation = crypto.randomUUID();
  assert.equal((await f.call('sync', '/sync/import', { generation, appointments: [appointment] })).status, 200);
  assert.equal((await f.call('sync', '/sync/commit', { generation, count: 1 })).status, 200);
  const data = { appointmentId: booking.id, employeeId: 'rayne', start: appointment.start, end: appointment.end };
  const remove = async (extra = {}, user = 'owner') => f.call(user, '/rental-staff/remove', { revision: (await f.call('owner', '/schedule')).data.revision, ...data, ...extra });
  return { ...f, remove };
}

test('only the owner can remove a rental teammate; stale times and revisions do not save', async t => {
  const f = await setup(t);
  for (const user of ['rayne', 'jordyn', 'sync', 'unknown']) assert.ok([401,403].includes((await f.remove({}, user)).status));
  assert.equal((await f.remove({ revision: -1 })).status, 409);
  assert.equal((await f.remove({ start: new Date(Date.parse(booking.start) + 1).toISOString() })).status, 409);
  assert.equal((await f.remove({ employeeId: 'owner' })).status, 400);
  assert.equal((await f.remove({ employeeId: 'akiva' })).status, 404);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM team_assignments').get().n, 0);
});

test('explicit removal clears a Calendar-only teammate in app, keeps other staff, and queues one durable removal', async t => {
  const f = await setup(t);
  assert.equal((await f.remove()).status, 200);
  await Promise.allSettled(f.pending);
  const schedule = (await f.call('owner', '/schedule')).data;
  assert.equal(schedule.assignments.length, 1);
  assert.equal(schedule.assignments[0].removeCalendarGuest, true);
  assert.equal(schedule.assignments[0].status, 'cancelled');
  assert.equal(schedule.assignments[0].calendarSync.status, 'needs_connection');
  assert.deepEqual(schedule.appointments[0].calendarInvitations.map(p => p.employeeId), ['jordyn']);
  assert.equal((await f.call('rayne', '/schedule')).data.appointments.length, 0);
  assert.equal((await f.remove()).status, 200);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM calendar_assignment_outbox').get().n, 1);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM team_assignments').get().n, 1);
});

test('removing a teammate cancels current offers but retains all prior responses and payroll records', async t => {
  const f = await setup(t);
  const old = { id: 'synthetic-old', employeeId: 'rayne', appointmentId: booking.id, title: booking.title, status: 'declined', start: booking.start, end: booking.end, createdAt: '2026-01-01T12:00:00Z', updatedAt: '2026-01-01T12:00:00Z' };
  const current = { ...old, id: 'synthetic-current', status: 'pending', createdAt: '2026-02-01T12:00:00Z' };
  for (const offer of [old, current]) f.DB.sqlite.prepare('INSERT INTO team_assignments(id,employee_id,data) VALUES(?,?,?)').run(offer.id, offer.employeeId, JSON.stringify(offer));
  f.DB.sqlite.prepare('INSERT INTO payroll_advances(id,employee_id,amount_cents,created_at,basis) VALUES(?,?,?,?,?)').run('synthetic-pay', 'rayne', 100, '2026-01-01', 'unpaid-and-future');
  const pay = f.DB.sqlite.prepare('SELECT * FROM payroll_advances').all();
  assert.equal((await f.remove()).status, 200);
  const saved = (await f.call('owner', '/schedule')).data.assignments;
  assert.equal(saved.find(a => a.id === old.id).status, 'declined');
  assert.equal(saved.find(a => a.id === current.id).status, 'cancelled');
  assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM payroll_advances').all(), pay);
});

test('a past rental cannot be changed by staff removal', async t => {
  const past = { ...booking, start: new Date(Date.now() - 7200000).toISOString(), end: new Date(Date.now() - 3600000).toISOString() };
  const f = await setup(t, past);
  assert.equal((await f.remove()).status, 400);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM team_assignments').get().n, 0);
});

test('a fresh Calendar invitation after verified removal is visible and can be removed again', async t => {
  const f = await setup(t);
  await f.remove(); await Promise.allSettled(f.pending);
  f.DB.sqlite.prepare("UPDATE calendar_assignment_outbox SET status = 'synced', result = ?, updated_at = ?").run(JSON.stringify({ code: 'person_removed' }), Date.now() - 10000);
  f.DB.sqlite.prepare('UPDATE team_state SET synced_at = ?').run(new Date().toISOString());
  assert.ok((await f.call('owner', '/schedule')).data.appointments[0].calendarInvitations.some(p => p.employeeId === 'rayne'));
  assert.equal((await f.remove()).status, 200);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM team_assignments').get().n, 2);
});

test('removal presentation never hides a newer active offer or a rescheduled rental', () => {
  const removed = { id: 'old', appointmentId: booking.id, employeeId: 'rayne', status: 'cancelled', start: booking.start, end: booking.end, removeCalendarGuest: true, createdAt: '2026-01-01' };
  assert.equal(rentalStaffRemovals(booking, [removed], null).length, 1);
  assert.equal(rentalStaffRemovals(booking, [removed, { ...removed, id: 'new', status: 'pending', removeCalendarGuest: false, createdAt: '2026-02-01' }], null).length, 0);
  assert.equal(withoutRemovedRentalStaff({ ...booking, start: new Date(Date.parse(booking.start) + 1000).toISOString() }, [removed], null).calendarInvitations.length, 2);
});
