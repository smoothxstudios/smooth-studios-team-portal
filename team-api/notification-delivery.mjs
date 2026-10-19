import { TEAM } from '../lib/team-schedule.mjs';
import { notificationText } from './notification-content.mjs';

// A random, per-alert/per-device receipt confirms delivery/opening of that alert.
// Its first open also marks that inbox entry read. It grants no account access
// and is sent only inside that device's encrypted push.
export async function pushReceiptRoute({request, db, body, fail}) {
  const input = await body(request), now = Date.now();
  if (!/^[A-Za-z0-9_-]{43}$/.test(input?.receipt ?? '') || !['received', 'opened'].includes(input?.stage)) fail(400, 'Invalid notification receipt.');
  const row = await db.prepare('SELECT alert_id FROM team_push_deliveries WHERE receipt_token = ? AND created_at >= ?')
    .bind(input.receipt, now - 7 * 86400_000).first();
  if (!row) fail(404, 'Notification receipt expired.');
  const opened = input.stage === 'opened';
  await db.batch([
    // Check before recording this device's first open, in the same transaction.
    // A duplicate receipt must not undo a later explicit Mark all → Unread.
    db.prepare(`UPDATE team_inbox SET push_received_at = COALESCE(push_received_at, ?),
      opened_at = CASE WHEN ? THEN COALESCE(opened_at, ?) ELSE opened_at END,
      read_at = CASE WHEN ? AND deleted_at IS NULL AND EXISTS
        (SELECT 1 FROM team_push_deliveries WHERE receipt_token = ? AND opened_at IS NULL)
        THEN COALESCE(read_at, ?) ELSE read_at END
      WHERE id = ?`)
      .bind(now, opened ? 1 : 0, now, opened ? 1 : 0, input.receipt, now, row.alert_id),
    db.prepare(`UPDATE team_push_deliveries SET completed_at = COALESCE(completed_at, ?), result = 'received', received_at = COALESCE(received_at, ?),
      opened_at = CASE WHEN ? THEN COALESCE(opened_at, ?) ELSE opened_at END
      WHERE receipt_token = ? AND (received_at IS NULL OR (? AND opened_at IS NULL))`)
      .bind(now, now, opened ? 1 : 0, now, input.receipt, opened ? 1 : 0),
  ]);
  return {saved: true};
}

export async function notificationDeliveryRoute({request, db, env, user, fail}) {
  if (user !== 'owner') fail(403, 'Only Smooth can review team delivery.');
  const person = new URL(request.url).searchParams.get('person') ?? 'all';
  const active = JSON.parse(env.TEAM_TOKEN_HASHES), people = TEAM.filter(p => p.id !== 'owner' && active[p.id]);
  if (person !== 'all' && !people.some(p => p.id === person)) fail(400, 'Choose an active team member.');
  const ids = people.map(p => p.id);
  const [devices, latest, alerts] = await Promise.all([
    db.prepare('SELECT user_id, COUNT(*) AS count FROM team_devices GROUP BY user_id').all(),
    db.prepare(`SELECT user_id, MAX(push_received_at) AS receivedAt, MAX(opened_at) AS openedAt
      FROM team_inbox WHERE user_id IN (SELECT value FROM json_each(?)) GROUP BY user_id`).bind(JSON.stringify(ids)).all(),
    db.prepare(`SELECT i.id, i.user_id AS userId, i.title, i.created_at AS createdAt, i.read_at AS readAt,
      i.push_accepted_at AS acceptedAt, i.push_received_at AS receivedAt, i.opened_at AS openedAt,
      (SELECT COUNT(*) FROM team_push_deliveries p WHERE p.alert_id = i.id AND p.completed_at IS NULL AND p.attempts < 8) AS retrying,
      (SELECT COUNT(*) FROM team_push_deliveries p WHERE p.alert_id = i.id AND p.result IN ('failed', 'expired')) AS failed,
      (SELECT COUNT(*) FROM team_push_deliveries p WHERE p.alert_id = i.id AND p.result IS NOT NULL) AS tracked,
      EXISTS(SELECT 1 FROM team_notification_events n WHERE n.id = i.id) AS queued
      FROM team_inbox i WHERE i.user_id IN (SELECT value FROM json_each(?))
      AND (? = 'all' OR i.user_id = ?) ORDER BY i.sequence DESC LIMIT 50`)
      .bind(JSON.stringify(ids), person, person).all(),
  ]);
  return {people: people.map(p => ({userId:p.id, name:p.name,
    devices:devices.results.find(d => d.user_id === p.id)?.count ?? 0,
    lastReceivedAt:latest.results.find(d => d.user_id === p.id)?.receivedAt ?? null,
    lastOpenedAt:latest.results.find(d => d.user_id === p.id)?.openedAt ?? null})),
    alerts:alerts.results.map(a => ({...a, title:notificationText(a.title,80)}))};
}
