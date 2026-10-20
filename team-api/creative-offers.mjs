import { withCreativeAdvance } from './payroll.mjs';
import { TEAM } from '../lib/team-schedule.mjs';
import { notificationText } from './notification-content.mjs';
import { flushAlerts } from './push.mjs';

// Linked offers keep each person's acceptance, earnings and submissions isolated.
export async function createCreativeOffers({ db, env, ctx, fail, input, terms, source, now }) {
  const ids = input.employeeIds ?? [input.employeeId];
  const active = JSON.parse(env.TEAM_TOKEN_HASHES);
  if (!Array.isArray(ids) || !ids.length || ids.length > TEAM.length - 1 || new Set(ids).size !== ids.length ||
      ids.some(id => !TEAM.some(person => person.id === id && id !== 'owner') || !active[id])) {
    fail(400, 'Choose one or more different people with active dashboard accounts.');
  }
  const groupId = source ? source.groupId ?? source.id : input.id;
  if (!/^[a-f0-9-]{36}$/.test(groupId ?? '')) fail(400, 'Create a fresh assignment and try again.');
  if (!source) {
    const existing = await db.prepare('SELECT data FROM team_creative_assignments WHERE id = ?').bind(groupId).first();
    if (existing) {
      const rows = await db.prepare("SELECT data FROM team_creative_assignments WHERE COALESCE(json_extract(data, '$.groupId'), id) = ?").bind(groupId).all();
      return { assignment: await withCreativeAdvance(db, JSON.parse(existing.data)), assignments: await Promise.all(rows.results.map(row => withCreativeAdvance(db, JSON.parse(row.data)))), duplicate: true };
    }
  }
  const groupMutation = crypto.randomUUID();
  const offers = await Promise.all(ids.map(async (employeeId, index) => {
    // Stable IDs also protect retries from creating a second offer for one person.
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${groupId}:${employeeId}`)))].map(b => b.toString(16).padStart(2, '0')).join('');
    const id = !source && index === 0 ? groupId : `${digest.slice(0,8)}-${digest.slice(8,12)}-${digest.slice(12,16)}-${digest.slice(16,20)}-${digest.slice(20,32)}`;
    const mutation = !source && index === 0 ? groupMutation : crypto.randomUUID();
    return { id, groupId, employeeId, ...terms, status: 'offered', version: 1, createdAt: now, updatedAt: now,
      approvedAt: null, submissions: [], payments: [], history: [{ id: mutation, event: 'assigned', by: 'owner', at: now }] };
  }));
  const anchor = source ? { ...source, groupId, version: source.version + 1, updatedAt: now,
    history: [...source.history, { id: groupMutation, event: 'people added', by: 'owner', at: now }] } : offers[0];
  const insert = item => db.prepare('INSERT OR IGNORE INTO team_creative_assignments (id, employee_id, version, mutation, data) VALUES (?, ?, ?, ?, ?)')
    .bind(item.id, item.employeeId, item.version, groupMutation, JSON.stringify(item));
  const writes = [source ? db.prepare(`UPDATE team_creative_assignments SET data = ?, version = ?, mutation = ? WHERE id = ? AND version = ?
    AND NOT EXISTS (SELECT 1 FROM team_creative_assignments WHERE COALESCE(json_extract(data, '$.groupId'), id) = ? AND employee_id IN (${ids.map(() => '?').join(',')}))`)
    .bind(JSON.stringify(anchor), anchor.version, groupMutation, source.id, source.version, groupId, ...ids) : insert(anchor)];
  for (const item of source ? offers : offers.slice(1)) {
    writes.push(db.prepare(`INSERT INTO team_creative_assignments (id, employee_id, version, mutation, data)
      SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM team_creative_assignments WHERE id = ? AND mutation = ?)`)
      .bind(item.id, item.employeeId, 1, groupMutation, JSON.stringify(item), anchor.id, groupMutation));
  }
  for (const item of offers) {
    const payload = { title: 'New creative assignment', body: `${notificationText(item.title,160)}. Open Creative Work to see the details.`, target: 'creative', targetId: item.id, personId: item.employeeId };
    writes.push(db.prepare(`INSERT INTO team_notification_events (id, user_id, kind, payload, due_at)
      SELECT ?, ?, 'creative', ?, ? WHERE EXISTS (SELECT 1 FROM team_creative_assignments WHERE id = ? AND mutation = ?)`)
      .bind(item.history[0].id, item.employeeId, JSON.stringify(payload), Date.now(), item.id, groupMutation));
  }
  const result = await db.batch(writes);
  if (!result[0].meta.changes) fail(409, 'This work changed or a selected person already has an assignment. Refresh and review the team.');
  ctx.waitUntil(flushAlerts(env));
  const savedAnchor = source ? await withCreativeAdvance(db, anchor) : anchor;
  return { assignment: savedAnchor, assignments: source ? [savedAnchor, ...offers] : offers };
}
