import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { cloudflareQuery, sendReminder, verifyReminder } from '../scripts/send-calendar-connect-reminder.mjs';
import { teamToken } from '../lib/team-auth.mjs';

const now = Date.parse('2026-10-17T18:00:00Z');
const batchId = 'd54a2d40-49a1-4f1b-a69d-78d4c5be8888';
const expected = ['rayne', 'jordyn', 'akiva'].map(id => ({ id: `notice_${batchId}_${id}`, user_id: id }));
const expectedBody = 'Please connect Google Calendar in Settings → Preferences → Google Calendar → Connect Google. Use the Google account that receives your studio invitations. If it is not available yet, check again after Smooth finishes setup.';
function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const folder = new URL('../team-api/migrations/', import.meta.url);
  for (const filename of readdirSync(folder).filter(name => name.endsWith('.sql') && name < '0021').sort()) db.exec(readFileSync(new URL(filename, folder), 'utf8'));
  const calls = [];
  const query = async (sql, params = []) => { calls.push({ sql, params }); return { results: db.prepare(sql).all(...params) }; };
  return { db, calls, query };
}
function seed(f) {
  for (const row of expected) f.db.prepare('INSERT INTO team_notification_events(id,user_id,kind,payload,due_at) VALUES(?,?,?,?,?)')
    .run(row.id, row.user_id, 'notice', JSON.stringify({ title: 'Connect your Google Calendar', body: expectedBody, target: 'settings', personId: 'owner' }), now);
}

test('the fixed reminder uses the authenticated owner API with exactly three recipients and one stable batch ID', async () => {
  const calls = [], password = 'synthetic-owner-password-only';
  const send = async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify({ sent: true, id: batchId, recipientCount: 3, notification: 'Queued' }), { status: 200 }); };
  const result = await sendReminder(send, { password });
  assert.deepEqual(result, { sent: true, id: batchId, recipientCount: 3 });
  assert.equal(calls[0].url, 'https://smooth-studios-team-api.smoothxstudios.workers.dev/notifications');
  assert.equal(calls[0].options.headers.authorization, `Bearer ${await teamToken(password, 'owner')}`);
  assert.equal(calls[0].options.redirect, 'error');
  assert.deepEqual(JSON.parse(calls[0].options.body), { id: batchId, recipientIds: ['rayne', 'jordyn', 'akiva'], title: 'Connect your Google Calendar', body: expectedBody, target: 'settings' });
  assert.doesNotMatch(calls[0].options.body, /synthetic-owner-password/);
  await sendReminder(send, { password });
  assert.equal(calls[1].options.body, calls[0].options.body, 'retries reuse the same server idempotency receipt');
});

test('read-only verification checks the exact archived message for only the three fixed recipients', async t => {
  const f = fixture(t); seed(f); const result = await verifyReminder(f.query);
  assert.equal(result.inboxCount, 3); assert.equal(result.queueCount, 3);
  assert.ok(f.calls.every(call => /^SELECT/.test(call.sql)));
  const rows = f.db.prepare('SELECT * FROM team_inbox ORDER BY sequence').all();
  assert.deepEqual(rows.map(row => ({ id: row.id, user_id: row.user_id })), expected);
  for (const row of rows) {
    assert.equal(row.title, 'Connect your Google Calendar'); assert.equal(row.body, expectedBody);
    assert.equal(row.kind, 'notice'); assert.equal(row.target, 'settings'); assert.equal(row.person_id, 'owner');
    assert.equal(row.created_at, now); assert.equal(row.read_at, null); assert.equal(row.deleted_at, null);
  }
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM team_inbox WHERE user_id NOT IN ('rayne','jordyn','akiva')").get().n, 0);
});

test('verification after delivery or soft deletion never recreates queue entries and preserves original read state', async t => {
  const f = fixture(t); seed(f);
  f.db.prepare('DELETE FROM team_notification_events').run();
  f.db.prepare('UPDATE team_inbox SET read_at = ?, deleted_at = ? WHERE user_id = ?').run(now + 2, now + 3, 'jordyn');
  const result = await verifyReminder(f.query);
  assert.equal(result.inboxCount, 3); assert.equal(result.queueCount, 0);
  const original = f.db.prepare('SELECT * FROM team_inbox WHERE user_id = ?').get('jordyn');
  assert.equal(original.read_at, now + 2); assert.equal(original.deleted_at, now + 3); assert.equal(original.created_at, now);
});

test('read-only verification reports recipient IDs and aggregate delivery metadata without exposing endpoints', async t => {
  const f = fixture(t); seed(f);
  for (const [id, user] of [['r1', 'rayne'], ['r2', 'rayne'], ['j1', 'jordyn'], ['other', 'amia']]) {
    f.db.prepare('INSERT INTO team_devices(id,user_id,endpoint,created_at) VALUES(?,?,?,?)').run(id, user, `https://web.push.apple.com/PRIVATE-ENDPOINT-${id}`, String(now));
  }
  for (const [alertId, deviceId, attempts, completed] of [
    [expected[0].id, 'r1', 1, now], [expected[0].id, 'r2', 1, null], [expected[1].id, 'j1', 4, null],
  ]) f.db.prepare('INSERT INTO team_push_deliveries(alert_id,device_id,attempts,created_at,completed_at) VALUES(?,?,?,?,?)').run(alertId, deviceId, attempts, now, completed);
  f.calls.length = 0;
  const result = await verifyReminder(f.query);
  assert.ok(f.calls.every(call => /^SELECT/.test(call.sql)));
  assert.deepEqual(result.recipients.map(row => [row.employeeId, row.registeredDevices]), [['rayne', 2], ['jordyn', 1], ['akiva', 0]]);
  assert.deepEqual(result.totals, { registeredDevices: 3, pushRecords: 3, pushAttempts: 6, pushCompleted: 1, pushPending: 1, pushExhausted: 1 });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-ENDPOINT|web\.push|endpoint|token|email|example\.invalid/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_notification_events').get().n, 3);
});

test('verification rejects a fixed-ID collision with the wrong inbox recipient or content', async t => {
  const f = fixture(t); seed(f);
  f.db.prepare('UPDATE team_inbox SET user_id = ? WHERE id = ?').run('amia', expected[0].id);
  await assert.rejects(verifyReminder(f.query), { message: 'The three fixed reminder inbox records could not be verified.' });
});

test('the Cloudflare adapter sends bound JSON and never returns credentials or provider error bodies', async () => {
  const calls = [];
  const query = await cloudflareQuery({ accountId: 'a'.repeat(32), databaseId: '12345678-1234-1234-1234-123456789012', apiToken: 'PRIVATE-TOKEN',
    fetcher: async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify({ success: true, result: [{ success: true, results: [{ count: 3 }] }] }), { status: 200 }); } });
  assert.deepEqual((await query('SELECT ? AS count', [3])).results, [{ count: 3 }]);
  assert.deepEqual(JSON.parse(calls[0].options.body), { sql: 'SELECT ? AS count', params: ['3'] });
  assert.equal(calls[0].options.redirect, 'error');
  const rejected = await cloudflareQuery({ accountId: 'a'.repeat(32), databaseId: '12345678-1234-1234-1234-123456789012', apiToken: 'PRIVATE-TOKEN',
    fetcher: async () => new Response(JSON.stringify({ success: false, errors: [{ message: 'PRIVATE PROVIDER ERROR PRIVATE-TOKEN' }] }), { status: 403 }) });
  await assert.rejects(rejected('SELECT 1'), { message: 'The Cloudflare reminder query failed (HTTP 403).' });
  await assert.rejects(query('DELETE FROM team_inbox'), { message: 'Only reminder verification reads are allowed.' });
});

test('send failures expose no owner credential or provider error body', async () => {
  const password = 'synthetic-owner-password-only';
  await assert.rejects(sendReminder(async () => new Response(JSON.stringify({ error: 'PRIVATE PROVIDER ERROR' }), { status: 401 }), { password }),
    { message: 'The Calendar reminder could not be verified (HTTP 401).' });
  await assert.rejects(sendReminder(async () => { throw new Error(`PRIVATE PROVIDER ERROR ${password}`); }, { password }),
    { message: 'The Calendar reminder request could not complete.' });
  await assert.rejects(sendReminder(async () => { throw new Error('Must not send'); }, {}),
    { message: 'The existing owner dashboard credential is required.' });
});
