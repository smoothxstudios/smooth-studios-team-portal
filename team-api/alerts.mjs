import { TEAM } from '../lib/team-schedule.mjs';
import { alertBody } from '../lib/alert-presentation.mjs';
import { notificationText } from './notification-content.mjs';

const targets = new Set(['scheduling', 'availability', 'creative', 'quiz']);
const validSequence = value => Number.isSafeInteger(value) && value >= 0;

export async function alertsRoute({ request, db, user, body, fail }) {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/alerts') {
    const filter = url.searchParams.get('filter') ?? 'all';
    const rawBefore = url.searchParams.get('before');
    const before = rawBefore === null ? null : Number(rawBefore);
    if (!['all', 'unread'].includes(filter) || (rawBefore !== null && (!/^\d+$/.test(rawBefore) || !validSequence(before) || before === 0))) fail(400, 'Choose All or Unread and a valid alerts page.');
    const summary = await db.prepare(`SELECT COALESCE(MAX(sequence), 0) AS throughSequence,
      COUNT(CASE WHEN read_at IS NULL THEN 1 END) AS unreadCount FROM team_inbox WHERE user_id = ?`).bind(user).first();
    if (url.searchParams.get('summary') === '1') return summary;
    const rows = (await db.prepare(`SELECT * FROM team_inbox WHERE user_id = ? AND sequence <= ?
      ${before === null ? '' : 'AND sequence < ?'} ${filter === 'unread' ? 'AND read_at IS NULL' : ''}
      ORDER BY sequence DESC LIMIT 51`).bind(user, summary.throughSequence, ...(before === null ? [] : [before])).all()).results;
    return { ...summary, nextCursor: rows.length > 50 ? rows[49].sequence : null,
      alerts: rows.slice(0, 50).map(row => ({
        id: row.id, sequence: row.sequence, kind: row.kind,
        title: notificationText(row.title, 80), body: alertBody(notificationText(row.body, 360)),
        personId: TEAM.some(person => person.id === row.person_id) ? row.person_id : null,
        target: targets.has(row.target) ? row.target : 'scheduling',
        targetId: typeof row.target_id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(row.target_id) ? row.target_id : null,
        createdAt: row.created_at, expiresAt: row.expires_at, readAt: row.read_at,
      })) };
  }
  if (request.method === 'PATCH' && ['/alerts/read', '/alerts/read-all'].includes(url.pathname)) {
    const input = await body(request), now = Date.now();
    if (url.pathname === '/alerts/read-all') {
      if (!validSequence(input.throughSequence)) fail(400, 'Refresh Alerts before marking all as read.');
      // A new alert arriving after the displayed snapshot stays unread.
      await db.prepare('UPDATE team_inbox SET read_at = ? WHERE user_id = ? AND sequence <= ? AND read_at IS NULL')
        .bind(now, user, input.throughSequence).run();
    } else {
      if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > 50 || input.ids.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id))) fail(400, 'Choose valid alerts to mark as read.');
      await db.prepare('UPDATE team_inbox SET read_at = ? WHERE user_id = ? AND id IN (SELECT value FROM json_each(?)) AND read_at IS NULL')
        .bind(now, user, JSON.stringify(input.ids)).run();
    }
    const row = await db.prepare('SELECT COUNT(*) AS unreadCount FROM team_inbox WHERE user_id = ? AND read_at IS NULL').bind(user).first();
    return { saved: true, readAt: now, unreadCount: row.unreadCount };
  }
  fail(404, 'Alerts action not found.');
}
