import assert from 'node:assert/strict';
import test from 'node:test';
import { paycheckNotification } from '../lib/paycheck-notification.mjs';
import { createNotificationDraft } from '../lib/team-notification-draft.mjs';
import { fixture } from './helpers/notification-fixture.mjs';

// Literal date formatting must survive Eastern DST boundaries and device zones.
test('paycheck ETA preserves the selected calendar day, including leap days and DST changes', () => {
  for (const [date, label] of [['2026-11-20', 'November 20, 2026'], ['2026-03-08', 'March 8, 2026'],
    ['2026-11-01', 'November 1, 2026'], ['2028-02-29', 'February 29, 2028']]) {
    assert.deepEqual(paycheckNotification(date), { title: 'Paycheck processed',
      body: `Your paycheck has been processed. ETA: ${label}.`, target: 'payouts' });
  }
  for (const invalid of ['', null, undefined, '2026-02-29', '2026-04-31', '2026-13-01', '2026-1-1', '2026-11-20T00:00Z']) {
    assert.equal(paycheckNotification(invalid), null);
  }
});

test('paycheck notices are owner-only, reach only selected inboxes, and never settle earnings', async t => {
  const f = await fixture(); delete f.env.VAPID_JWK;
  t.after(async () => { await Promise.allSettled(f.pending); f.close(); });
  const added = await f.call('owner', '/creative-work/manual-pay', { id: crypto.randomUUID(), employeeId: 'rayne',
    category: 'training', workDate: '2026-01-01', amountCents: 1234, paymentStatus: 'owed', note: '' });
  assert.equal(added.status, 200);
  const before = (await f.call('rayne', '/payroll')).data;
  const intent = createNotificationDraft();
  const draft = { recipientIds: ['rayne', 'jordyn'], ...paycheckNotification('2026-11-20') };
  const input = intent.prepare(draft);
  for (const role of ['rayne', 'jordyn', 'sync']) assert.equal((await f.call(role, '/notifications', input)).status, 403);
  const result = await f.call('owner', '/notifications', input);
  assert.equal(result.status, 200); assert.equal(result.data.recipientCount, 2);
  assert.match(result.data.notification, /queued/);
  const alerts = f.DB.sqlite.prepare("SELECT * FROM team_inbox WHERE title='Paycheck processed' ORDER BY user_id").all();
  assert.deepEqual(alerts.map(item => item.user_id), ['jordyn', 'rayne']);
  assert.ok(alerts.every(item => item.body === draft.body && item.target === 'payouts'));
  assert.equal((await f.call('akiva', '/alerts')).data.alerts.length, 0);
  assert.deepEqual((await f.call('rayne', '/payroll')).data, before);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM payroll_receipts').get().n, 0);
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM team_inbox WHERE title='You just got paid 💸'").get().n, 0);
  const history = (await f.call('owner', '/notifications/sent')).data.notices;
  assert.equal(history[0].body, draft.body); assert.equal(history[0].target, 'payouts');

  // A lost response can be retried without a second inbox record or push event.
  const retry = intent.prepare({ ...draft, recipientIds: ['jordyn', 'rayne'] });
  assert.equal(retry.id, input.id);
  assert.equal((await f.call('owner', '/notifications', retry)).status, 200);
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM team_inbox WHERE title='Paycheck processed'").get().n, 2);
  const changed = intent.prepare({ ...draft, ...paycheckNotification('2026-11-21') });
  assert.notEqual(changed.id, input.id);
  assert.equal((await f.call('owner', '/notifications', { ...changed, id: input.id })).status, 409);
});
