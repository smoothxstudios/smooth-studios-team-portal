import { TEAM } from "../lib/team-schedule.mjs";
import { tokenHash } from "../lib/team-auth.mjs";
import { notificationText, notificationTime } from "./notification-content.mjs";
import { flushAlerts } from "./push.mjs";
import { rentalAlertTargetId } from "../lib/alert-target.mjs";

const employees = new Set(TEAM.filter(person => person.id !== "owner").map(person => person.id));
const targets = new Set(["alerts", "settings", "scheduling", "creative", "availability"]);
const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
const interval = 5 * 60_000;
const queued = item => ({ sent: true, id: item.id, recipientCount: JSON.parse(item.recipient_ids).length,
  notification: "Added to team Alerts. A notification was queued for enabled devices." });
const eventRows = item => JSON.parse(item.recipient_ids).map(userId => ({ id: `notice_${item.id}_${userId}`, userId }));

function clean(value, length, label, fail) {
  if (typeof value !== "string" || Array.from(value).length > length) fail(400, `Enter a ${label} of up to ${length} characters.`);
  const text = notificationText(value, length);
  if (!text) fail(400, `Enter a ${label}.`);
  return text;
}
async function receipt(db, id, hash, fail) {
  const item = await db.prepare("SELECT * FROM manual_notices WHERE id = ?").bind(id).first();
  if (!item) return null;
  if (item.request_hash !== hash) fail(409, "That notification request was already used for a different message. Start a new notification.");
  return item;
}
async function verifiedResult(db, item, fail) {
  const result = await db.prepare(`SELECT COUNT(*) AS count FROM team_inbox i JOIN json_each(?) e
    ON i.id = json_extract(e.value, '$.id') AND i.user_id = json_extract(e.value, '$.userId')`)
    .bind(JSON.stringify(eventRows(item))).first();
  // Tombstones count as the original saved receipt; never recreate a deleted alert.
  if (result.count !== JSON.parse(item.recipient_ids).length) fail(503, "The notification could not be verified in Alerts. Please try again.");
  return queued(item);
}
function publicItem(item) {
  return { id: item.id, recipientIds: JSON.parse(item.recipient_ids), title: item.title, body: item.body,
    target: item.target, createdAt: item.created_at };
}

export async function manualNoticesRoute({ request, env, user, body, fail, ctx }) {
  if (user !== "owner") fail(403, "Only Smooth can send team notifications.");
  const url = new URL(request.url), db = env.DB;
  if (request.method === "GET" && url.pathname === "/notifications/sent") {
    const rows = (await db.prepare("SELECT * FROM manual_notices ORDER BY created_at DESC, id DESC LIMIT 20").all()).results;
    return { notices: rows.map(publicItem) };
  }
  const match = url.pathname.match(/^\/assignments\/([0-9a-f-]+)\/remind$/i);
  if (request.method !== "POST" || (url.pathname !== "/notifications" && !match)) fail(404, "Notification action not found.");
  const input = await body(request);
  if (!uuid(input.id) || (match && !uuid(match[1]))) fail(400, "Start a new notification and try again.");
  const id = input.id.toLowerCase(), assignmentId = match?.[1].toLowerCase() ?? null;
  let recipients, title, message, target, assignment, rawAssignment, context, rentalState;
  if (!assignmentId) {
    if (!Array.isArray(input.recipientIds) || input.recipientIds.length < 1 || input.recipientIds.length > employees.size ||
        input.recipientIds.some(person => !employees.has(person)) || new Set(input.recipientIds).size !== input.recipientIds.length) fail(400, "Choose one or more team members.");
    recipients = [...input.recipientIds].sort();
    title = clean(input.title, 80, "title", fail); message = clean(input.body, 360, "message", fail);
    target = input.target ?? "alerts";
    if (!targets.has(target)) fail(400, "Choose Alerts, Settings, Schedule, Creative work, or Availability as the destination.");
    if (input.context !== undefined) {
      const value = input.context;
      if (!value || Array.isArray(value) || value.type !== "rental" || typeof value.appointmentId !== "string" ||
          !value.appointmentId.trim() || value.appointmentId.length > 300 || typeof value.start !== "string" || typeof value.end !== "string" ||
          !Number.isFinite(Date.parse(value.start)) || !Number.isFinite(Date.parse(value.end)) || Date.parse(value.end) <= Date.parse(value.start)) fail(400, "Choose a current studio rental for this reminder.");
      context = { type: "rental", appointmentId: value.appointmentId.trim(), start: new Date(value.start).toISOString(), end: new Date(value.end).toISOString() };
      if (target !== "scheduling") fail(400, "Rental reminders must open Schedule.");
    }
  }
  const hash = await tokenHash(JSON.stringify(assignmentId ? { kind: "reminder", assignmentId }
    : { kind: "notice", recipientIds: recipients, title, body: message, target, ...(context ? { context } : {}) }));
  const previous = await receipt(db, id, hash, fail);
  if (previous) return verifiedResult(db, previous, fail);
  if (context) {
    rentalState = await db.prepare("SELECT revision, generation FROM team_state WHERE id = 1").first();
    const row = rentalState && await db.prepare("SELECT data FROM team_appointments WHERE generation = ? AND id = ?")
      .bind(rentalState.generation, context.appointmentId).first();
    const appointment = row ? JSON.parse(row.data) : null;
    if (!appointment || !/\bstudio(?:\s+[a-z])?\s+rentals?\b/i.test(appointment.title ?? "") ||
        Date.parse(appointment.start) <= Date.now() || Date.parse(appointment.start) !== Date.parse(context.start) ||
        Date.parse(appointment.end) !== Date.parse(context.end)) fail(409, "This rental changed or is no longer upcoming. Refresh the reminder and choose it again.");
    const accepted = new Set((appointment.acceptedEmployeeIds ?? []).filter(person => employees.has(person)));
    const assignments = (await db.prepare("SELECT data FROM team_assignments WHERE json_extract(data, '$.appointmentId') = ? AND json_extract(data, '$.status') = 'accepted'")
      .bind(appointment.id).all()).results.map(item => JSON.parse(item.data));
    for (const item of assignments) if (employees.has(item.employeeId) && Date.parse(item.start) === Date.parse(appointment.start) &&
      Date.parse(item.end) === Date.parse(appointment.end)) accepted.add(item.employeeId);
    if (recipients.some(person => !accepted.has(person))) fail(409, "The rental’s confirmed team changed. Refresh and choose its confirmed team members.");
  }
  if (assignmentId) {
    const row = await db.prepare("SELECT data FROM team_assignments WHERE id = ?").bind(assignmentId).first();
    if (!row) fail(404, "Assignment not found.");
    rawAssignment = row.data; assignment = JSON.parse(row.data);
    if (assignment.status !== "pending" || !employees.has(assignment.employeeId) || !Number.isFinite(Date.parse(assignment.start)) || !Number.isFinite(Date.parse(assignment.end)) ||
        Date.parse(assignment.start) <= Date.now() || Date.parse(assignment.end) <= Date.parse(assignment.start)) fail(409, "Only upcoming assignments awaiting a response can receive a reminder.");
    recipients = [assignment.employeeId]; title = "Assignment response reminder";
    message = notificationText(`${notificationText(assignment.title, 120)} · ${notificationTime(assignment.start, assignment.end)}. Please accept or decline this offer in your dashboard.`, 360);
    target = "scheduling";
  }
  const now = Date.now(), token = crypto.randomUUID(), recipientIds = JSON.stringify(recipients);
  const targetId = assignmentId ?? (context ? rentalAlertTargetId(context.appointmentId) : null);
  const item = { id, request_hash: hash, recipient_ids: recipientIds, title, body: message, target,
    target_id: targetId, assignment_id: assignmentId, operation_token: token, created_at: now };
  let guard = assignmentId
    ? `EXISTS (SELECT 1 FROM team_assignments WHERE id = ? AND data = ? AND json_extract(data, '$.status') = 'pending'
        AND julianday(json_extract(data, '$.start')) > julianday(?))
      AND NOT EXISTS (SELECT 1 FROM manual_notices WHERE assignment_id = ? AND created_at > ?)`
    : `NOT EXISTS (SELECT 1 FROM json_each(?) r WHERE
      (SELECT COUNT(*) FROM manual_notices m WHERE m.assignment_id IS NULL AND m.created_at > ?
        AND EXISTS (SELECT 1 FROM json_each(m.recipient_ids) p WHERE p.value = r.value)) >= 5)`;
  if (context) guard += " AND EXISTS (SELECT 1 FROM team_state WHERE id = 1 AND revision = ? AND generation = ?)";
  const events = recipients.map(userId => ({ id: `notice_${id}_${userId}`, userId,
    payload: JSON.stringify({ title, body: message, target, ...(targetId ? { targetId } : {}), personId: "owner" }) }));
  const results = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO manual_notices
      (id, request_hash, recipient_ids, title, body, target, target_id, assignment_id, operation_token, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`)
      .bind(id, hash, recipientIds, title, message, target, targetId, assignmentId, token, now,
        ...(assignmentId ? [assignmentId, rawAssignment, new Date(now).toISOString(), assignmentId, now - interval] : [recipientIds, now - interval]),
        ...(context ? [rentalState.revision, rentalState.generation] : [])),
    db.prepare(`INSERT OR IGNORE INTO team_notification_events(id, user_id, kind, payload, due_at)
      SELECT json_extract(value, '$.id'), json_extract(value, '$.userId'), 'notice', json_extract(value, '$.payload'), ?
      FROM json_each(?) WHERE EXISTS (SELECT 1 FROM manual_notices WHERE id = ? AND request_hash = ? AND operation_token = ?)`)
      .bind(now, JSON.stringify(events), id, hash, token),
  ]);
  if (!results[0].meta.changes) {
    const saved = await receipt(db, id, hash, fail);
    if (saved) return verifiedResult(db, saved, fail);
    if (context) {
      const current = await db.prepare("SELECT revision, generation FROM team_state WHERE id = 1").first();
      if (!current || current.revision !== rentalState.revision || current.generation !== rentalState.generation) fail(409, "The schedule changed. Refresh the rental reminder before sending it.");
    }
    if (assignmentId) {
      const latest = await db.prepare("SELECT data FROM team_assignments WHERE id = ?").bind(assignmentId).first();
      if (!latest || latest.data !== rawAssignment) fail(409, "This assignment changed. Refresh it before sending a reminder.");
      fail(429, "A reminder was already sent for this assignment. Wait five minutes before sending another.");
    }
    fail(429, "A team member has received five notifications in five minutes. Wait before sending another.");
  }
  const result = await verifiedResult(db, item, fail);
  ctx.waitUntil(flushAlerts(env));
  return result;
}
