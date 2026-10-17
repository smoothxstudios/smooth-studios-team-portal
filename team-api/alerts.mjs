import { TEAM } from '../lib/team-schedule.mjs';
import { alertBody } from '../lib/alert-presentation.mjs';
import { notificationText } from './notification-content.mjs';
import { safeAlertTargetId } from '../lib/alert-target.mjs';

const targets = new Set(['scheduling', 'availability', 'creative', 'quiz', 'settings', 'alerts']);
const validSequence = value => Number.isSafeInteger(value) && value >= 0;
const validAlertIds = ids => Array.isArray(ids) && ids.length > 0 && ids.length <= 50 &&
  ids.every(id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id));

async function unreadCount(db, user) {
  const row = await db.prepare('SELECT COUNT(*) AS unreadCount FROM team_inbox WHERE user_id = ? AND deleted_at IS NULL AND read_at IS NULL').bind(user).first();
  return row.unreadCount;
}

export async function alertsRoute({ request, db, user, body, fail }) {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/alerts') {
    const filter = url.searchParams.get('filter') ?? 'all';
    const rawBefore = url.searchParams.get('before');
    const before = rawBefore === null ? null : Number(rawBefore);
    if (!['all', 'unread'].includes(filter) || (rawBefore !== null && (!/^\d+$/.test(rawBefore) || !validSequence(before) || before === 0))) fail(400, 'Choose All or Unread and a valid alerts page.');
    const summary = await db.prepare(`SELECT COALESCE(MAX(sequence), 0) AS throughSequence,
      COUNT(CASE WHEN read_at IS NULL THEN 1 END) AS unreadCount FROM team_inbox WHERE user_id = ? AND deleted_at IS NULL`).bind(user).first();
    if (url.searchParams.get('summary') === '1') return summary;
    const rows = (await db.prepare(`SELECT * FROM team_inbox WHERE user_id = ? AND deleted_at IS NULL AND sequence <= ?
      ${before === null ? '' : 'AND sequence < ?'} ${filter === 'unread' ? 'AND read_at IS NULL' : ''}
      ORDER BY sequence DESC LIMIT 51`).bind(user, summary.throughSequence, ...(before === null ? [] : [before])).all()).results;
    return { ...summary, nextCursor: rows.length > 50 ? rows[49].sequence : null,
      alerts: rows.slice(0, 50).map(row => ({
        id: row.id, sequence: row.sequence, kind: row.kind,
        title: notificationText(row.title, 80), body: alertBody(notificationText(row.body, 360)),
        personId: TEAM.some(person => person.id === row.person_id) ? row.person_id : null,
        target: targets.has(row.target) ? row.target : 'scheduling',
        targetId: safeAlertTargetId(row.kind, row.target, row.target_id),
        createdAt: row.created_at, expiresAt: row.expires_at, readAt: row.read_at,
      })) };
  }
  if (request.method === 'PATCH' && url.pathname === '/alerts/unread-all') {
    const input = await body(request);
    if (!validSequence(input.throughSequence)) fail(400, 'Refresh Alerts before marking all as unread.');
    // Reopen only this account's displayed snapshot, retaining deletion and
    // the read state of newer alerts that arrived on another device.
    await db.prepare('UPDATE team_inbox SET read_at = NULL WHERE user_id = ? AND deleted_at IS NULL AND sequence <= ? AND read_at IS NOT NULL')
      .bind(user, input.throughSequence).run();
    return { saved: true, readAt: null, unreadCount: await unreadCount(db, user) };
  }
  if (request.method === 'PATCH' && ['/alerts/read', '/alerts/read-all'].includes(url.pathname)) {
    const input = await body(request), now = Date.now();
    if (url.pathname === '/alerts/read-all') {
      if (!validSequence(input.throughSequence)) fail(400, 'Refresh Alerts before marking all as read.');
      // A new alert arriving after the displayed snapshot stays unread.
      await db.prepare('UPDATE team_inbox SET read_at = ? WHERE user_id = ? AND deleted_at IS NULL AND sequence <= ? AND read_at IS NULL')
        .bind(now, user, input.throughSequence).run();
    } else {
      if (!validAlertIds(input?.ids)) fail(400, 'Choose valid alerts to mark as read.');
      await db.prepare('UPDATE team_inbox SET read_at = ? WHERE user_id = ? AND deleted_at IS NULL AND id IN (SELECT value FROM json_each(?)) AND read_at IS NULL')
        .bind(now, user, JSON.stringify(input.ids)).run();
    }
    return { saved: true, readAt: now, unreadCount: await unreadCount(db, user) };
  }
  if (request.method === 'DELETE' && url.pathname === '/alerts') {
    const input = await body(request), now = Date.now();
    if (!validAlertIds(input?.ids)) fail(400, 'Choose valid alerts to delete.');
    // Keep each unique inbox record as a tombstone. Notification delivery and
    // retries can still complete without recreating a dismissed inbox alert.
    await db.prepare('UPDATE team_inbox SET deleted_at = ? WHERE user_id = ? AND deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))')
      .bind(now, user, JSON.stringify(input.ids)).run();
    return { unreadCount: await unreadCount(db, user), deletedAt: now };
  }
  if (request.method === 'PATCH' && url.pathname === '/alerts/restore') {
    const input = await body(request);
    if (!validAlertIds(input?.ids)) fail(400, 'Choose valid alerts to restore.');
    // Undo changes visibility only; the original read status is retained.
    await db.prepare('UPDATE team_inbox SET deleted_at = NULL WHERE user_id = ? AND deleted_at IS NOT NULL AND id IN (SELECT value FROM json_each(?))')
      .bind(user, JSON.stringify(input.ids)).run();
    return { unreadCount: await unreadCount(db, user) };
  }
  fail(404, 'Alerts action not found.');
}
