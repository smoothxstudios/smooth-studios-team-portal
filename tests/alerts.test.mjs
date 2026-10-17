import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fixture, device, answerCurrent } from './helpers/notification-fixture.mjs';
import { flushAlerts } from '../team-api/push.mjs';
import { sendQuizReminders } from '../team-api/quiz-notifications.mjs';
import { QUIZ_INTERVAL_MS } from '../lib/team-engagement.mjs';

const now = Date.parse('2026-10-16T18:00:00Z');
mock.timers.enable({ apis: ['Date'], now });
test.beforeEach(() => mock.timers.setTime(now));
test.after(() => mock.timers.reset());
const enqueue = (db, id, user = 'jordyn', details = {}) => db.prepare('INSERT INTO team_notification_events(id,user_id,kind,payload,due_at) VALUES (?,?,?,?,?)')
  .run(id, user, 'assignment', JSON.stringify({ title: 'Synthetic assignment', body: 'Review the scheduled work.', target: 'scheduling', ...details }), now);

test('delivered and device-less alerts stay private in the inbox, with persistent idempotent read status', async t => {
  const f = await fixture(); t.after(() => f.close());
  const d = device('inbox'); await f.call('jordyn', '/push/device', d);
  enqueue(f.DB.sqlite, 'delivered'); enqueue(f.DB.sqlite, 'without-device', 'rayne');
  let deliveries = 0;
  await flushAlerts(f.env, async () => { deliveries++; return new Response(null, { status: 201 }); });
  assert.equal(deliveries, 1);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM team_notification_events').get().n, 0);
  assert.deepEqual((await f.call('jordyn', '/alerts')).data.alerts.map(a => a.id), ['delivered']);
  assert.deepEqual((await f.call('owner', '/alerts')).data.alerts, []);
  assert.deepEqual((await f.call('rayne', '/alerts?userId=jordyn')).data.alerts.map(a => a.id), ['without-device']);
  assert.equal((await f.call('sync', '/alerts')).status, 403);
  assert.equal((await f.call('unknown', '/alerts')).status, 401);
  await f.call('rayne', '/alerts/read', { ids: ['delivered'] }, 'PATCH');
  assert.equal((await f.call('jordyn', '/alerts')).data.unreadCount, 1);
  const first = await f.call('jordyn', '/alerts/read', { ids: ['delivered'] }, 'PATCH');
  assert.equal(first.status, 200); assert.equal(first.data.unreadCount, 0);
  mock.timers.setTime(now + 1000);
  await f.call('jordyn', '/alerts/read', { ids: ['delivered'] }, 'PATCH');
  const reopened = (await f.call('jordyn', '/alerts')).data;
  assert.equal(reopened.alerts[0].readAt, now);
  assert.equal((await f.call('jordyn', '/alerts?filter=unread')).data.alerts.length, 0);
  assert.equal((await f.call('rayne', '/alerts')).data.unreadCount, 1);
});

test('reading an offer does not accept it; accepted responses link Smooth to that exact assignment', async t => {
  const f = await fixture(); delete f.env.VAPID_JWK; t.after(async () => { await Promise.all(f.pending); f.close(); });
  f.DB.sqlite.prepare('UPDATE team_state SET synced_at = ? WHERE id = 1').run(new Date(now).toISOString());
  const input = { revision: 0, employeeId: 'jordyn', startLocal: '2026-10-17T13:00', endLocal: '2026-10-17T14:00', title: 'Synthetic task', instructions: 'Private brief' };
  assert.equal((await f.call('owner', '/assignments', input)).status, 200);
  const assignment = (await f.call('jordyn', '/schedule')).data.assignments[0];
  const offer = (await f.call('jordyn', '/alerts')).data.alerts[0];
  assert.equal(offer.target, 'scheduling'); assert.equal(offer.targetId, assignment.id);
  await f.call('jordyn', '/alerts/read', { ids: [offer.id] }, 'PATCH');
  assert.equal((await f.call('jordyn', '/schedule')).data.assignments[0].status, 'pending');
  assert.equal((await f.call('owner', '/assignments', input)).status, 409);
  assert.equal((await f.call('jordyn', '/alerts')).data.alerts.length, 1);
  assert.equal((await f.call('jordyn', `/assignments/${assignment.id}`, { revision: 1, status: 'accepted' })).status, 200);
  const response = (await f.call('owner', '/alerts')).data.alerts[0];
  assert.match(response.title, /accepted/); assert.equal(response.targetId, assignment.id);
  assert.deepEqual((await f.call('rayne', '/alerts')).data.alerts, []);
});

test('creative events keep precise targets without publishing briefs, and retries cannot duplicate inbox entries', async t => {
  const f = await fixture(); delete f.env.VAPID_JWK; t.after(async () => { await Promise.all(f.pending); f.close(); });
  const input = { id: crypto.randomUUID(), employeeId: 'jordyn', title: 'Synthetic creative edit', instructions: 'PRIVATE DETAILS', references: [], dueLocal: '2026-10-20T17:00', amountCents: 10000 };
  const result = await f.call('owner', '/creative-work', input); assert.equal(result.status, 200);
  await f.call('owner', '/creative-work', input);
  const inbox = (await f.call('jordyn', '/alerts')).data;
  assert.equal(inbox.alerts.length, 1); assert.equal(inbox.alerts[0].target, 'creative'); assert.equal(inbox.alerts[0].targetId, input.id);
  assert.doesNotMatch(JSON.stringify(inbox), /PRIVATE DETAILS/);
  await f.call('jordyn', '/alerts/read-all', { throughSequence: inbox.throughSequence }, 'PATCH');
  assert.equal((await f.call('jordyn', '/creative-work')).data.assignments[0].status, 'offered');
});

test('pagination is stable with identical timestamps; mark-all preserves newer arrivals and other accounts', async t => {
  const f = await fixture(); t.after(() => f.close());
  for (let i = 0; i < 64; i++) enqueue(f.DB.sqlite, `event-${i}`);
  enqueue(f.DB.sqlite, 'someone-else', 'rayne');
  const first = (await f.call('jordyn', '/alerts')).data;
  assert.equal(first.alerts.length, 50); assert.equal(first.unreadCount, 64);
  enqueue(f.DB.sqlite, 'new-arrival');
  const second = (await f.call('jordyn', `/alerts?before=${first.nextCursor}`)).data;
  assert.equal(second.alerts.length, 14); assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.alerts, ...second.alerts].map(a => a.id)).size, 64);
  await f.call('jordyn', '/alerts/read-all', { throughSequence: first.throughSequence }, 'PATCH');
  assert.deepEqual((await f.call('jordyn', '/alerts?filter=unread')).data.alerts.map(a => a.id), ['new-arrival']);
  assert.deepEqual((await f.call('jordyn', '/alerts?summary=1')).data, { throughSequence: 66, unreadCount: 1 });
  assert.equal((await f.call('rayne', '/alerts')).data.unreadCount, 1);
  for (const query of ['filter=other', 'before=-1', 'before=0', 'before=hi', 'before=1.5', 'before=9007199254740992']) assert.equal((await f.call('jordyn', `/alerts?${query}`)).status, 400);
  for (const ids of [[], ['bad/id'], Array(51).fill('id'), [4]]) assert.equal((await f.call('jordyn', '/alerts/read', { ids }, 'PATCH')).status, 400);
  for (const throughSequence of [null, -1, '1', 1.5]) assert.equal((await f.call('jordyn', '/alerts/read-all', { throughSequence }, 'PATCH')).status, 400);
});

test('quiz inbox reminders require a started day, survive push being off and receipt cleanup, and never duplicate', async t => {
  const f = await fixture(); delete f.env.VAPID_JWK; t.after(() => f.close());
  const mustNotSend = () => { throw new Error('Push is off'); };
  await sendQuizReminders(f.env, mustNotSend); assert.equal((await f.call('jordyn', '/alerts')).data.alerts.length, 0);
  await answerCurrent(f);
  mock.timers.setTime(now + QUIZ_INTERVAL_MS - 1); await sendQuizReminders(f.env, mustNotSend);
  assert.equal((await f.call('jordyn', '/alerts')).data.alerts.length, 0);
  mock.timers.setTime(now + QUIZ_INTERVAL_MS);
  await Promise.all([sendQuizReminders(f.env, mustNotSend), sendQuizReminders(f.env, mustNotSend)]);
  const inbox = (await f.call('jordyn', '/alerts')).data;
  assert.equal(inbox.alerts.length, 1); assert.equal(inbox.alerts[0].title, 'Quiz Time'); assert.equal(inbox.alerts[0].target, 'quiz');
  assert.equal(inbox.alerts[0].expiresAt, Date.parse('2026-10-17T04:00:00Z'));
  assert.doesNotMatch(JSON.stringify(inbox), /correctOptionId|questionId/);
  assert.deepEqual((await f.call('rayne', '/alerts')).data.alerts, []);
  await f.call('jordyn', '/alerts/read', { ids: [inbox.alerts[0].id] }, 'PATCH');
  assert.equal((await f.call('jordyn')).data.answeredToday, 1);
  mock.timers.setTime(now + 10 * 86400_000); await sendQuizReminders(f.env, mustNotSend);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM team_quiz_reminders').get().n, 0);
  assert.equal((await f.call('jordyn', '/alerts')).data.alerts.length, 1);
});

test('migration backfills queued events without replaying push, rolls back atomically, and normalizes destinations', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const folder = new URL('../team-api/migrations/', import.meta.url);
  for (const file of readdirSync(folder).filter(name => name.endsWith('.sql') && name < '0018').sort()) db.exec(readFileSync(new URL(file, folder), 'utf8'));
  enqueue(db, 'before-migration');
  db.exec(readFileSync(new URL('0018_alerts_inbox.sql', folder), 'utf8'));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM team_inbox').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM team_notification_events').get().n, 1);
  db.exec('BEGIN'); enqueue(db, 'rolled-back'); db.exec('ROLLBACK');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM team_inbox').get().n, 1);
  const f = await fixture(); t.after(() => f.close());
  enqueue(f.DB.sqlite, 'untrusted', 'jordyn', { title: 'Hello\nworld', target: 'https://example.invalid', targetId: 'javascript:bad' });
  const alert = (await f.call('jordyn', '/alerts')).data.alerts[0];
  assert.equal(alert.target, 'scheduling'); assert.equal(alert.targetId, null); assert.equal(alert.title, 'Hello world');
});

test('person attribution survives queue cleanup and stays scoped to the alert recipient', async t => {
  const f = await fixture(); t.after(() => f.close());
  enqueue(f.DB.sqlite, 'person-owned', 'owner', { personId: 'jordyn', body: 'Oct 20. Open your schedule to review.' });
  enqueue(f.DB.sqlite, 'wrong-person', 'owner', { personId: 'not-a-member' });
  f.DB.sqlite.prepare('DELETE FROM team_notification_events').run();
  const result = (await f.call('owner', '/alerts')).data.alerts;
  assert.equal(result.find(a => a.id === 'person-owned').personId, 'jordyn');
  assert.equal(result.find(a => a.id === 'person-owned').body, 'Oct 20.');
  assert.equal(result.find(a => a.id === 'wrong-person').personId, null);
  assert.deepEqual((await f.call('jordyn', '/alerts')).data.alerts, []);
});

test('delete and undo are account-scoped, idempotent, and retain each alert’s original read status', async t => {
  const f = await fixture(); t.after(() => f.close());
  enqueue(f.DB.sqlite, 'read-alert'); enqueue(f.DB.sqlite, 'unread-alert'); enqueue(f.DB.sqlite, 'other-alert', 'rayne');
  await f.call('jordyn', '/alerts/read', { ids: ['read-alert'] }, 'PATCH');
  const original = (await f.call('jordyn', '/alerts')).data;
  await f.call('owner', '/alerts', { ids: ['read-alert', 'unread-alert'] }, 'DELETE');
  assert.equal((await f.call('jordyn', '/alerts')).data.alerts.length, 2);
  const deleted = await f.call('jordyn', '/alerts', { ids: ['read-alert', 'unread-alert', 'other-alert'] }, 'DELETE');
  assert.equal(deleted.status, 200); assert.deepEqual(deleted.data, { unreadCount: 0, deletedAt: now });
  assert.deepEqual((await f.call('jordyn', '/alerts?summary=1')).data, { throughSequence: 0, unreadCount: 0 });
  assert.deepEqual((await f.call('jordyn', '/alerts')).data.alerts, []);
  assert.equal((await f.call('rayne', '/alerts')).data.unreadCount, 1);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM team_notification_events').get().n, 3);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM team_inbox').get().n, 3);
  mock.timers.setTime(now + 1000);
  await f.call('jordyn', '/alerts', { ids: ['unread-alert'] }, 'DELETE');
  assert.equal(f.DB.sqlite.prepare('SELECT deleted_at FROM team_inbox WHERE id = ?').get('unread-alert').deleted_at, now);
  await f.call('rayne', '/alerts/restore', { ids: ['unread-alert'] }, 'PATCH');
  await f.call('owner', '/alerts/restore', { ids: ['unread-alert'] }, 'PATCH');
  assert.deepEqual((await f.call('jordyn', '/alerts')).data.alerts, []);
  // Read commands on another device cannot silently read a dismissed alert.
  await f.call('jordyn', '/alerts/read', { ids: ['unread-alert'] }, 'PATCH');
  await f.call('jordyn', '/alerts/read-all', { throughSequence: original.throughSequence }, 'PATCH');
  const readRestore = await f.call('jordyn', '/alerts/restore', { ids: ['read-alert', 'other-alert'] }, 'PATCH');
  assert.equal(readRestore.status, 200); assert.equal(readRestore.data.unreadCount, 0);
  assert.equal((await f.call('jordyn', '/alerts')).data.alerts[0].readAt, now);
  const unreadRestore = await f.call('jordyn', '/alerts/restore', { ids: ['unread-alert'] }, 'PATCH');
  assert.equal(unreadRestore.status, 200); assert.equal(unreadRestore.data.unreadCount, 1);
  assert.deepEqual((await f.call('jordyn', '/alerts?filter=unread')).data.alerts.map(a => [a.id, a.readAt]), [['unread-alert', null]]);
  await f.call('jordyn', '/alerts/restore', { ids: ['unread-alert'] }, 'PATCH');
  assert.equal((await f.call('jordyn', '/alerts')).data.alerts.length, 2);
  for (const ids of [[], ['bad/id'], Array(51).fill('id'), [4], null, undefined]) {
    assert.equal((await f.call('jordyn', '/alerts', { ids }, 'DELETE')).status, 400);
    assert.equal((await f.call('jordyn', '/alerts/restore', { ids }, 'PATCH')).status, 400);
  }
  assert.equal((await f.call('sync', '/alerts', { ids: ['unread-alert'] }, 'DELETE')).status, 403);
});

test('deleted alerts are absent from counts and stable paginated results while newer arrivals stay unread', async t => {
  const f = await fixture(); t.after(() => f.close());
  for (let i = 0; i < 65; i++) enqueue(f.DB.sqlite, `page-${i}`);
  const ids = ['page-64', 'page-35', 'page-2', 'page-0'];
  await f.call('jordyn', '/alerts', { ids }, 'DELETE');
  const first = (await f.call('jordyn', '/alerts')).data;
  assert.equal(first.alerts.length, 50); assert.equal(first.unreadCount, 61);
  assert.equal(first.throughSequence, 64);
  enqueue(f.DB.sqlite, 'later-alert');
  const second = (await f.call('jordyn', `/alerts?before=${first.nextCursor}`)).data;
  assert.equal(second.alerts.length, 11); assert.equal(second.nextCursor, null);
  const visible = [...first.alerts, ...second.alerts].map(alert => alert.id);
  assert.equal(new Set(visible).size, 61); assert.ok(ids.every(id => !visible.includes(id)));
  await f.call('jordyn', '/alerts/read-all', { throughSequence: first.throughSequence }, 'PATCH');
  assert.deepEqual((await f.call('jordyn', '/alerts?filter=unread')).data.alerts.map(a => a.id), ['later-alert']);
  const restored = await f.call('jordyn', '/alerts/restore', { ids }, 'PATCH');
  assert.equal(restored.data.unreadCount, 5);
  assert.equal((await f.call('jordyn', '/alerts')).data.unreadCount, 5);
});

test('notification retries cannot resurrect a deleted inbox alert or change its read status', async t => {
  const f = await fixture(); t.after(() => f.close());
  const d = device('deleted-retry'); await f.call('jordyn', '/push/device', d);
  enqueue(f.DB.sqlite, 'retry-alert');
  await f.call('jordyn', '/alerts/read', { ids: ['retry-alert'] }, 'PATCH');
  await f.call('jordyn', '/alerts', { ids: ['retry-alert'] }, 'DELETE');
  let deliveries = 0;
  await flushAlerts(f.env, async () => { deliveries++; return new Response(null, { status: 201 }); });
  assert.equal(deliveries, 1);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM team_notification_events').get().n, 0);
  enqueue(f.DB.sqlite, 'retry-alert', 'jordyn', { title: 'Retried event' });
  assert.deepEqual((await f.call('jordyn', '/alerts')).data.alerts, []);
  const tombstone = f.DB.sqlite.prepare('SELECT title, read_at, deleted_at FROM team_inbox WHERE id = ?').get('retry-alert');
  assert.equal(tombstone.title, 'Synthetic assignment'); assert.equal(tombstone.read_at, now); assert.equal(tombstone.deleted_at, now);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM team_inbox WHERE id = ?').get('retry-alert').n, 1);
  await f.call('jordyn', '/alerts/restore', { ids: ['retry-alert'] }, 'PATCH');
  const restored = (await f.call('jordyn', '/alerts')).data;
  assert.equal(restored.unreadCount, 0); assert.equal(restored.alerts[0].readAt, now);
});

test('dismissing an assignment alert leaves its assignment and engagement records untouched', async t => {
  const f = await fixture(); delete f.env.VAPID_JWK; t.after(async () => { await Promise.all(f.pending); f.close(); });
  f.DB.sqlite.prepare('UPDATE team_state SET synced_at = ? WHERE id = 1').run(new Date(now).toISOString());
  const input = { revision: 0, employeeId: 'jordyn', startLocal: '2026-10-17T13:00', endLocal: '2026-10-17T14:00', title: 'Synthetic assignment', instructions: 'Synthetic brief' };
  assert.equal((await f.call('owner', '/assignments', input)).status, 200);
  const assignment = (await f.call('jordyn', '/schedule')).data.assignments[0];
  await answerCurrent(f);
  const engagement = (await f.call('jordyn')).data;
  const ids = (await f.call('jordyn', '/alerts')).data.alerts.map(alert => alert.id);
  await f.call('jordyn', '/alerts', { ids }, 'DELETE');
  assert.deepEqual((await f.call('jordyn', '/schedule')).data.assignments[0], assignment);
  assert.deepEqual((await f.call('jordyn')).data, engagement);
  assert.deepEqual((await f.call('jordyn', '/alerts')).data.alerts, []);
});

test('deletion migration preserves existing inbox history and quiz retry triggers retain tombstones', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const folder = new URL('../team-api/migrations/', import.meta.url);
  for (const file of readdirSync(folder).filter(name => name.endsWith('.sql') && name < '0020').sort()) db.exec(readFileSync(new URL(file, folder), 'utf8'));
  enqueue(db, 'existing-unread'); enqueue(db, 'existing-read');
  db.prepare('UPDATE team_inbox SET read_at = ? WHERE id = ?').run(now, 'existing-read');
  const before = db.prepare('SELECT * FROM team_inbox ORDER BY sequence').all();
  db.exec(readFileSync(new URL('0020_alert_deletion.sql', folder), 'utf8'));
  const after = db.prepare('SELECT * FROM team_inbox ORDER BY sequence').all();
  assert.deepEqual(after.map(({ deleted_at, ...alert }) => alert), before.map(alert => ({ ...alert })));
  assert.ok(after.every(alert => alert.deleted_at === null));
  const reminder = ['quiz-retry', 'jordyn', '2026-10-16', 'synthetic-question', now, now + 86400000];
  db.prepare('INSERT INTO team_quiz_reminders(id,user_id,day,question_id,created_at,expires_at) VALUES (?,?,?,?,?,?)').run(...reminder);
  db.prepare('UPDATE team_inbox SET deleted_at = ? WHERE id = ?').run(now, 'quiz-retry');
  db.prepare('DELETE FROM team_quiz_reminders WHERE id = ?').run('quiz-retry');
  db.prepare('INSERT INTO team_quiz_reminders(id,user_id,day,question_id,created_at,expires_at) VALUES (?,?,?,?,?,?)').run(...reminder);
  assert.equal(db.prepare('SELECT deleted_at FROM team_inbox WHERE id = ?').get('quiz-retry').deleted_at, now);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM team_inbox WHERE id = ?').get('quiz-retry').n, 1);
});
