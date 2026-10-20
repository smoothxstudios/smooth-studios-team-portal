import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEAM, TEAM_API_URL } from '../lib/team-schedule.mjs';
import { teamToken } from '../lib/team-auth.mjs';

const recipients = ['rayne', 'jordyn', 'akiva'];
const batchId = 'd54a2d40-49a1-4f1b-a69d-78d4c5be8888';
const reminders = recipients.map(employeeId => ({ employeeId, id: `notice_${batchId}_${employeeId}` }));
const ids = JSON.stringify(reminders.map(item => item.id));
const title = 'Connect your Google Calendar';
const message = 'Please connect Google Calendar in Settings → Preferences → Google Calendar → Connect Google. Use the Google account that receives your studio invitations. If it is not available yet, check again after Smooth finishes setup.';
if (recipients.some(id => !TEAM.some(person => person.id === id && person.id !== 'owner')) || title.length > 80 || message.length > 360) throw new Error('The fixed Calendar reminder is invalid.');

/** The injected query returns {results:[...]} and never receives credentials. */
export async function verifyReminder(query) {
  const inbox = await query(`SELECT id, user_id, kind, title, body, target, person_id FROM team_inbox
    WHERE id IN (SELECT value FROM json_each(?))`, [ids]);
  const expected = new Map(reminders.map(item => [item.id, item.employeeId]));
  if (!Array.isArray(inbox.results) || inbox.results.length !== 3 || inbox.results.some(row => expected.get(row.id) !== row.user_id ||
      row.kind !== 'notice' || row.title !== title || row.body !== message || row.target !== 'settings' || row.person_id !== 'owner')) {
    throw new Error('The three fixed reminder inbox records could not be verified.');
  }
  const devices = await query(`SELECT user_id, COUNT(*) AS count FROM team_devices
    WHERE user_id IN (SELECT value FROM json_each(?)) GROUP BY user_id`, [JSON.stringify(recipients)]);
  const delivery = await query(`SELECT alert_id, COUNT(*) AS count, SUM(attempts) AS attempts,
    SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) AS completed,
    SUM(CASE WHEN completed_at IS NULL AND attempts < 4 THEN 1 ELSE 0 END) AS pending,
    SUM(CASE WHEN completed_at IS NULL AND attempts >= 4 THEN 1 ELSE 0 END) AS exhausted
    FROM team_push_deliveries WHERE alert_id IN (SELECT value FROM json_each(?)) GROUP BY alert_id`, [ids]);
  const queue = await query('SELECT COUNT(*) AS count FROM team_notification_events WHERE id IN (SELECT value FROM json_each(?))', [ids]);
  const people = reminders.map(item => {
    const pushed = delivery.results.find(row => row.alert_id === item.id);
    return { employeeId: item.employeeId, alertId: item.id,
      registeredDevices: Number(devices.results.find(row => row.user_id === item.employeeId)?.count ?? 0),
      pushRecords: Number(pushed?.count ?? 0), pushAttempts: Number(pushed?.attempts ?? 0),
      pushCompleted: Number(pushed?.completed ?? 0), pushPending: Number(pushed?.pending ?? 0), pushExhausted: Number(pushed?.exhausted ?? 0) };
  });
  return { inboxCount: inbox.results.length, queueCount: Number(queue.results[0]?.count ?? 0), recipients: people,
    totals: Object.fromEntries(['registeredDevices', 'pushRecords', 'pushAttempts', 'pushCompleted', 'pushPending', 'pushExhausted']
      .map(key => [key, people.reduce((sum, person) => sum + person[key], 0)])) };
}

/** Send through the owner API so history, idempotence and push use one path. */
export async function sendReminder(send = fetch, { password } = {}) {
  if (typeof password !== 'string' || password.length < 16) throw new Error('The existing owner dashboard credential is required.');
  const token = await teamToken(password, 'owner');
  let response;
  try { response = await send(`${TEAM_API_URL}/notifications`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ id: batchId, recipientIds: recipients, title, body: message, target: 'settings' }) }); }
  catch { throw new Error('The Calendar reminder request could not complete.'); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.sent !== true || result.id !== batchId || result.recipientCount !== 3) {
    throw new Error(`The Calendar reminder could not be verified (HTTP ${response.status}).`);
  }
  return { sent: true, id: batchId, recipientCount: 3 };
}

export async function cloudflareQuery({ accountId, apiToken, databaseId, fetcher = fetch }) {
  if (!/^[a-f0-9]{32}$/.test(accountId ?? '') || !apiToken || !/^[a-f0-9-]{36}$/.test(databaseId ?? '')) throw new Error('The existing Cloudflare account and D1 credentials are required.');
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  return async (sql, params = []) => {
    if (!/^\s*SELECT\b/i.test(sql) || sql.includes(';')) throw new Error('Only reminder verification reads are allowed.');
    let response;
    try { response = await fetcher(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sql, params: params.map(value => String(value)) }) }); }
    catch { throw new Error('The Cloudflare reminder request could not complete.'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success !== true || !Array.isArray(data.result) || data.result.length !== 1 || data.result[0].success !== true || !Array.isArray(data.result[0].results)) {
      throw new Error(`The Cloudflare reminder query failed (HTTP ${response.status}).`);
    }
    return data.result[0];
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--verify-only') || args.length > 1) throw new Error('Use no flags to queue the fixed reminder, or --verify-only to inspect delivery metadata.');
  const config = JSON.parse(await readFile(new URL('../team-api/wrangler.jsonc', import.meta.url), 'utf8'));
  const binding = config.d1_databases?.find(database => database.binding === 'DB');
  const query = await cloudflareQuery({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID?.trim(),
    apiToken: process.env.CLOUDFLARE_API_TOKEN?.trim(), databaseId: binding?.database_id });
  const sent = args.includes('--verify-only') ? null : await sendReminder(fetch, { password: process.env.DASHBOARD_PASSWORD_OWNER });
  const result = { ...(sent ? { sent } : {}), ...await verifyReminder(query) };
  // Metadata only: never print provider responses, tokens or device endpoints.
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
