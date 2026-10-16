import { tokenHash } from "../lib/team-auth.mjs";
import { TEAM, localInstant as parseLocalInstant, addLocalDays, assignmentConflicts, hasConflictOverride } from "../lib/team-schedule.mjs";
import { deliverPush, flushAlerts, publicPushKey, pushDeliveryMessage, pushEndpoint } from "./push.mjs";
import { engagementRoute } from "./engagement.mjs";
import { subscriptionKeys } from "./push-encryption.mjs";
import { sendQuizReminders } from "./quiz-notifications.mjs";
import { assignmentNotifications, blockNotifications } from "./notification-content.mjs";
import { creativeWorkRoute } from "./creative-work.mjs";
import { alertsRoute } from "./alerts.mjs";
import { payrollRoute } from "./payroll.mjs";
import { studioReferenceRoute } from "./studio-reference.mjs";

const users = TEAM.map(p => p.id);
const origins = new Set(["https://smoothxstudios.github.io", "https://dashboard.smoothstudios.co", "https://smooth-studios-team-portal.felixhansley.chatgpt.site"]);
const active = a => a.status === "pending" || a.status === "accepted";
const guard = "EXISTS (SELECT 1 FROM team_state WHERE id = 1 AND mutation = ?)";
class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new ApiError(status, message); };
function localInstant(value) {
  try { return parseLocalInstant(value); } catch (error) { fail(400, error.message); }
}
function text(value, max = 160, required = true) {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) fail(400, "Check the required fields and text length.");
  return value.trim();
}
function person(value, employeesOnly = false) {
  if (!users.includes(value) || (employeesOnly && value === "owner")) fail(400, "Choose a team member.");
  return value;
}
function owner(user) { if (user !== "owner") fail(403, "Only Smooth can change assignments."); }
function syncOnly(user) { if (user !== "sync") fail(403, "This endpoint is reserved for the calendar sync."); }
function futurePeriod(start, end) {
  if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) ||
      Date.parse(start) <= Date.now() || Date.parse(end) <= Date.parse(start) ||
      Date.parse(end) - Date.parse(start) > 7 * 86400_000 || Date.parse(start) > Date.now() + 366 * 86400_000) {
    fail(400, "Choose a future time within the next year, with an end after the start (up to 7 days).");
  }
}
async function body(request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) fail(415, "JSON is required.");
  const reader = request.body?.getReader();
  if (!reader) fail(400, "A request body is required.");
  const chunks = []; let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 256_000) { await reader.cancel(); fail(413, "This request is too large."); }
    chunks.push(value);
  }
  try {
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || Array.isArray(value) || typeof value !== "object") throw new Error();
    return value;
  } catch { fail(400, "Invalid JSON request."); }
}
async function authenticate(request, env) {
  if (!env.TEAM_TOKEN_HASHES) fail(503, "Team scheduling is not configured yet.");
  const token = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) fail(401, "Unlock your dashboard to use team scheduling.");
  const digest = await tokenHash(token);
  const hashes = JSON.parse(env.TEAM_TOKEN_HASHES);
  let found = null;
  for (const id of [...users, "sync"]) {
    const expected = hashes[id] ?? "";
    let difference = expected.length ^ digest.length;
    for (let i = 0; i < digest.length; i++) difference |= digest.charCodeAt(i) ^ (expected.charCodeAt(i) || 0);
    if (!difference) found = id;
  }
  if (!found) fail(401, "Your scheduling session is invalid. Lock and unlock the dashboard again.");
  return found;
}
const jsonRows = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results.map(r => JSON.parse(r.data));
async function snapshot(db) {
  const state = await db.prepare("SELECT * FROM team_state WHERE id = 1").first();
  if (!state) fail(503, "The scheduling database needs its deployment migration.");
  const [appointments, blocks, assignments] = await Promise.all([
    jsonRows(db, "SELECT data FROM team_appointments WHERE generation = ?", state.generation),
    jsonRows(db, "SELECT data FROM team_blocks"),
    jsonRows(db, "SELECT data FROM team_assignments"),
  ]);
  return { state, appointments, blocks, assignments };
}
function expectedRevision(input, state) {
  if (!Number.isInteger(input.revision) || input.revision !== state.revision) fail(409, "The schedule changed. Refresh, review it, and try again.");
}
async function commit(db, state, makeStatements, notifications = []) {
  const id = crypto.randomUUID();
  const statements = [db.prepare("UPDATE team_state SET revision = revision + 1, mutation = ? WHERE id = 1 AND revision = ?").bind(id, state.revision), ...makeStatements(id)];
  if (notifications.length) statements.push(db.prepare(`INSERT INTO team_notification_events (id, user_id, kind, payload, due_at)
    SELECT json_extract(value, '$.id'), json_extract(value, '$.userId'), json_extract(value, '$.kind'),
      json_extract(value, '$.payload'), ? FROM json_each(?) WHERE ${guard}`)
    .bind(Date.now(), JSON.stringify(notifications.map(({ userId, kind, title, body, target, targetId }) => ({
      id: crypto.randomUUID(), userId, kind, payload: JSON.stringify({ title, body, target, targetId }),
    }))), id));
  const result = await db.batch(statements);
  if (!result[0].meta.changes) fail(409, "The schedule changed. Refresh, review it, and try again.");
}
function saveAssignment(db, item, mutation) {
  return db.prepare(`INSERT INTO team_assignments (id, employee_id, data) SELECT ?, ?, ? WHERE ${guard}
    ON CONFLICT(id) DO UPDATE SET data = excluded.data`).bind(item.id, item.employeeId, JSON.stringify(item), mutation);
}
function checkConflicts(employeeId, period, s, excludeId = "") {
  const conflicts = assignmentConflicts(employeeId, period, s.blocks, s.assignments, s.appointments, excludeId);
  if (conflicts.length) fail(409, `This time conflicts with ${conflicts.slice(0, 3).join("; ")}. Choose another person or time.`);
}
function approveConflict(period) {
  return { approvedBy: "owner", approvedAt: new Date().toISOString(), start: period.start, end: period.end };
}

async function route(request, env, ctx) {
  const url = new URL(request.url), db = env.DB;
  if (request.method === "GET" && url.pathname === "/studio-reference/key") {
    if (!env.STUDIO_REFERENCE_KEY) fail(503, "Secure import is not ready.");
    const { kty, n, e } = JSON.parse(env.STUDIO_REFERENCE_KEY);
    return { publicKey: { kty, n, e, alg: "RSA-OAEP-256", key_ops: ["encrypt"], ext: true } };
  }
  if (request.method === "GET" && url.pathname === "/health") {
    const ready = Boolean(env.TEAM_TOKEN_HASHES && db && await db.prepare("SELECT id FROM team_state WHERE id = 1").first());
    return { version: 1, ready, pushReady: Boolean(env.VAPID_JWK), identityVersion: 1, availabilityVersion: 1, engagementVersion: 5, notificationVersion: 3, creativeWorkVersion: 1, studioReferenceVersion: 1, payrollVersion: 1, alertsVersion: 1 };
  }
  const user = await authenticate(request, env);
  if (url.pathname.startsWith("/sync/")) syncOnly(user);
  else if (user === "sync") fail(403, "Sync access is restricted to synchronization endpoints.");
  if (url.pathname === "/alerts" || url.pathname.startsWith("/alerts/")) return alertsRoute({ request, db, user, body, fail });
  if (url.pathname === "/payroll" || url.pathname.startsWith("/sync/payroll")) return payrollRoute({ request, db, user, env, body, fail });
  if (["/studio-reference", "/sync/studio-reference", "/rental-checklists"].includes(url.pathname) || url.pathname.startsWith("/rental-checklists/")) return studioReferenceRoute({ request, db, user, env, body, fail });
  if (url.pathname === "/creative-work" || url.pathname.startsWith("/creative-work/")) return creativeWorkRoute({ request, db, user, env, ctx, body, fail });
  if (url.pathname === "/engagement" || url.pathname.startsWith("/engagement/")) return engagementRoute({ request, db, user, env, body, fail });

  // The content vault verifies existing dashboard credentials server-to-server.
  // Return identity only: no calendar, payroll, passwords, or workflow tokens.
  const identity = person => ({ id: person.id, username: person.id === "owner" ? "smooth" : person.id,
    name: person.name, role: person.id === "owner" ? "owner" : "member" });
  if (request.method === "GET" && url.pathname === "/identity") {
    return { user: identity(TEAM.find(person => person.id === user)) };
  }
  if (request.method === "GET" && url.pathname === "/identity/team") {
    owner(user);
    const hashes = JSON.parse(env.TEAM_TOKEN_HASHES);
    return { members: TEAM.filter(person => hashes[person.id]).map(identity) };
  }

  if (request.method === "GET" && url.pathname === "/guidelines/questions") {
    const rows = user === "owner"
      ? await db.prepare("SELECT id, asked_by, question, status, created_at FROM guideline_questions ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, created_at DESC LIMIT 500").all()
      : await db.prepare("SELECT id, asked_by, question, status, created_at FROM guideline_questions WHERE asked_by = ? ORDER BY created_at DESC LIMIT 100").bind(user).all();
    return { questions: rows.results.map(row => ({ id: row.id, askedBy: row.asked_by, question: row.question, status: row.status, createdAt: row.created_at })) };
  }
  if (request.method === "POST" && url.pathname === "/guidelines/questions") {
    const input = await body(request), question = text(input.question, 300).replace(/\s+/g, " ");
    if (question.length < 8) fail(400, "Add a specific question of at least 8 characters.");
    const normalized = question.toLowerCase().replace(/[?!.,]+$/, "");
    const existing = await db.prepare("SELECT id FROM guideline_questions WHERE asked_by = ? AND normalized = ?").bind(user, normalized).first();
    if (existing) return { id: existing.id, saved: true, duplicate: true };
    const id = crypto.randomUUID(), now = new Date().toISOString();
    // A single statement keeps simultaneous submissions within the per-person cap.
    const result = await db.prepare(`INSERT OR IGNORE INTO guideline_questions (id, asked_by, question, normalized, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM guideline_questions WHERE asked_by = ? AND status = 'open') < 60`)
      .bind(id, user, question, normalized, now, now, user).run();
    if (!result.meta.changes) {
      const duplicate = await db.prepare("SELECT id FROM guideline_questions WHERE asked_by = ? AND normalized = ?").bind(user, normalized).first();
      if (duplicate) return { id: duplicate.id, saved: true, duplicate: true };
      fail(400, "Your question list is full. Ask Smooth to review the existing questions.");
    }
    return { id, saved: true };
  }
  if (request.method === "PATCH" && url.pathname.startsWith("/guidelines/questions/")) {
    if (user !== "owner") fail(403, "Only Smooth can manage the question queue.");
    const input = await body(request);
    if (!["open", "answered", "dismissed"].includes(input.status)) fail(400, "Choose open, answered or dismissed.");
    const result = await db.prepare("UPDATE guideline_questions SET status = ?, updated_at = ? WHERE id = ?")
      .bind(input.status, new Date().toISOString(), url.pathname.slice("/guidelines/questions/".length)).run();
    if (!result.meta.changes) fail(404, "Question not found.");
    return { saved: true };
  }

  if (request.method === "GET" && url.pathname === "/schedule") {
    const s = await snapshot(db), isOwner = user === "owner";
    const assignments = s.assignments.filter(a => isOwner || a.employeeId === user);
    const ids = new Set(assignments.filter(active).map(a => a.appointmentId));
    const devices = (await db.prepare("SELECT user_id, COUNT(*) AS count FROM team_devices GROUP BY user_id").all()).results;
    const workPreferences = user === "owner"
      ? await jsonRows(db, "SELECT data FROM team_work_preferences")
      : await jsonRows(db, "SELECT data FROM team_work_preferences WHERE user_id = ?", user);
    return { revision: s.state.revision, syncedAt: s.state.synced_at, availabilityVersion: 1, workPreferences,
      appointments: s.appointments.filter(a => isOwner || ids.has(a.id) || a.acceptedEmployeeIds.includes(user))
        .map(a => isOwner ? a : { ...a, acceptedEmployeeIds: a.acceptedEmployeeIds.filter(id => id === user) }),
      blocks: s.blocks.filter(b => isOwner || b.userId === user), assignments,
      devices: Object.fromEntries(devices.filter(d => isOwner || d.user_id === user).map(d => [d.user_id, d.count])),
      pushPublicKey: env.VAPID_JWK ? publicPushKey(JSON.parse(env.VAPID_JWK)) : null,
    };
  }
  if (request.method === "GET" && url.pathname === "/sync/accepted") {
    const assignments = await jsonRows(db, "SELECT data FROM team_assignments");
    const devices = await db.prepare("SELECT COUNT(*) AS count FROM team_devices").first();
    const alerts = await db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN attempts > 0 THEN 1 ELSE 0 END), 0) AS retrying
      FROM (SELECT attempts FROM team_alerts UNION ALL SELECT attempts FROM team_notification_events)`).first();
    return { assignments: assignments
      .filter(a => a.status === "accepted" && a.appointmentId)
      .map(({ appointmentId, employeeId, start, end }) => ({ appointmentId, employeeId, start, end })),
      calendarAssignments: assignments.filter(a => a.appointmentId)
        .map(({ appointmentId, employeeId, start, end, status }) => ({ appointmentId, employeeId, start, end, status })),
      pushDiagnostics: { registeredDevices: devices.count, queuedAlerts: alerts.count, retryingAlerts: alerts.retrying },
    };
  }
  if (request.method === "POST" && url.pathname === "/sync/import") {
    const input = await body(request), generation = text(input.generation, 80);
    if (!Array.isArray(input.appointments) || input.appointments.length > 100) fail(400, "Import up to 100 appointments at a time.");
    const appointments = input.appointments.map(a => {
      if (!Number.isFinite(Date.parse(a.start)) || !Number.isFinite(Date.parse(a.end)) || Date.parse(a.end) <= Date.parse(a.start) ||
          !Number.isInteger(a.priceCents) || a.priceCents < 0 || !Array.isArray(a.acceptedEmployeeIds)) fail(400, "Invalid appointment snapshot.");
      return { id: text(a.id, 300), title: text(a.title, 300), customer: text(a.customer, 200, false),
        start: new Date(a.start).toISOString(), end: new Date(a.end).toISOString(), priceCents: a.priceCents,
        acceptedEmployeeIds: [...new Set(a.acceptedEmployeeIds.map(p => person(p, true)))],
      };
    });
    const state = await db.prepare("SELECT generation FROM team_state WHERE id = 1").first();
    if (state.generation === generation) fail(409, "Create a new import generation.");
    await db.prepare(`INSERT INTO team_appointments (generation, id, data)
      SELECT ?, json_extract(value, '$.id'), value FROM json_each(?) WHERE true
      ON CONFLICT(generation, id) DO UPDATE SET data = excluded.data`).bind(generation, JSON.stringify(appointments)).run();
    return { imported: appointments.length };
  }
  if (request.method === "POST" && url.pathname === "/sync/commit") {
    const input = await body(request), generation = text(input.generation, 80), s = await snapshot(db);
    const next = await jsonRows(db, "SELECT data FROM team_appointments WHERE generation = ?", generation);
    if (!Number.isInteger(input.count) || next.length !== input.count) fail(409, "The calendar import is incomplete.");
    const changes = [], notifications = [];
    const appointmentsById = new Map(next.map(a => [a.id, a]));
    for (const a of s.assignments.filter(a => a.appointmentId && active(a))) {
      const appointment = appointmentsById.get(a.appointmentId);
      if (!appointment) {
        changes.push({ ...a, status: "cancelled", note: "Appointment removed from Calendar.", updatedAt: new Date().toISOString() });
        notifications.push(...assignmentNotifications(a, "removed", [a.employeeId, "owner"]));
      } else if (Date.parse(a.start) !== Date.parse(appointment.start) || Date.parse(a.end) !== Date.parse(appointment.end)) {
        const status = Date.parse(appointment.start) > Date.now() ? "pending" : "cancelled";
        changes.push({ ...a, start: appointment.start, end: appointment.end, status, conflictOverride: undefined,
          note: status === "pending" ? "Calendar time changed. Please accept the new time." : "Time changed to a past appointment. Smooth must review it.", updatedAt: new Date().toISOString() });
        notifications.push(...assignmentNotifications({ ...a, start: appointment.start, end: appointment.end }, status === "pending" ? "rescheduled" : "past", [a.employeeId, "owner"]));
      }
    }
    await commit(db, s.state, mutation => [
      db.prepare(`UPDATE team_state SET generation = ?, synced_at = ? WHERE id = 1 AND ${guard}`).bind(generation, new Date().toISOString(), mutation),
      db.prepare(`UPDATE team_assignments SET data = (SELECT value FROM json_each(?) WHERE json_extract(value, '$.id') = team_assignments.id)
        WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?)) AND ${guard}`)
        .bind(JSON.stringify(changes), JSON.stringify(changes), mutation),
    ], notifications);
    // The old snapshot remains available until the atomic generation switch.
    await db.prepare("DELETE FROM team_appointments WHERE generation != ?").bind(generation).run();
    if (notifications.length) ctx.waitUntil(flushAlerts(env));
    return { synced: next.length };
  }
  if (["POST", "PATCH", "DELETE"].includes(request.method) &&
      (url.pathname === "/work-preferences" || /^\/work-preferences\/[^/]+$/.test(url.pathname))) {
    const input = await body(request), s = await snapshot(db);
    expectedRevision(input, s.state);
    const id = url.pathname.slice("/work-preferences/".length);
    const existing = id ? (await jsonRows(db, "SELECT data FROM team_work_preferences WHERE id = ?", id))[0] : null;
    if (request.method !== "POST" && (!existing || (user !== "owner" && existing.userId !== user))) fail(404, "Work preference not found.");
    if (request.method === "POST" && id) fail(404, "Use Add work preference to create an entry.");
    if (request.method === "DELETE") {
      await commit(db, s.state, mutation => [db.prepare(`DELETE FROM team_work_preferences WHERE id = ? AND ${guard}`).bind(existing.id, mutation)]);
      return { deleted: true };
    }
    const userId = existing?.userId ?? (user === "owner" ? person(input.userId, true) : user);
    if (userId === "owner") fail(400, "Choose an employee for a work preference.");
    const startLocal = text(input.startLocal, 16), endLocal = text(input.endLocal, 16);
    const start = localInstant(startLocal), end = localInstant(endLocal);
    const localDuration = Date.parse(`${endLocal}Z`) - Date.parse(`${startLocal}Z`);
    if (localDuration <= 0 || localDuration > 86400_000 || Date.parse(start) > Date.now() + 366 * 86400_000) {
      fail(400, "Choose up to one day of preferred work time within the next year, with an end after the start.");
    }
    if (input.allDay !== undefined && typeof input.allDay !== "boolean") fail(400, "Choose a full day or specific hours.");
    const allDay = input.allDay === true;
    if (allDay && (!startLocal.endsWith("T00:00") || endLocal !== addLocalDays(startLocal, 1))) fail(400, "A full day must run from midnight to the following midnight.");
    const repeatUntil = input.repeatUntil ? text(input.repeatUntil, 10) : null;
    let lastEnd = end;
    if (repeatUntil) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(repeatUntil) || !Number.isFinite(Date.parse(`${repeatUntil}T12:00Z`)) ||
          new Date(`${repeatUntil}T12:00Z`).toISOString().slice(0, 10) !== repeatUntil ||
          repeatUntil < startLocal.slice(0, 10) || repeatUntil > addLocalDays(startLocal, 364).slice(0, 10)) fail(400, "Weekly preferences need an end date within one year of their first day.");
      for (let d = 7; addLocalDays(startLocal, d).slice(0, 10) <= repeatUntil; d += 7) {
        localInstant(addLocalDays(startLocal, d)); lastEnd = localInstant(addLocalDays(endLocal, d));
      }
    }
    // Today is valid while the selected work window is still in progress.
    if (Date.parse(lastEnd) <= Date.now()) fail(400, "Choose a day or weekly series that still has upcoming work time.");
    const preferences = await jsonRows(db, "SELECT data FROM team_work_preferences WHERE user_id = ?", userId);
    if (!existing && preferences.length >= 200) fail(400, "Remove an old work preference before adding more (200 per person).");
    if (preferences.some(p => p.id !== existing?.id && p.startLocal === startLocal && p.endLocal === endLocal && p.repeatUntil === repeatUntil)) fail(409, "That work preference is already saved. Edit the existing entry instead.");
    const item = { id: existing?.id ?? crypto.randomUUID(), userId, startLocal, endLocal, repeatUntil, allDay,
      note: text(input.note ?? "", 120, false), createdAt: existing?.createdAt ?? new Date().toISOString() };
    await commit(db, s.state, mutation => [db.prepare(`INSERT INTO team_work_preferences (id, user_id, data) SELECT ?, ?, ? WHERE ${guard}
      ON CONFLICT(id) DO UPDATE SET data = excluded.data`).bind(item.id, userId, JSON.stringify(item), mutation)]);
    return { saved: true };
  }
  if (request.method === "POST" && url.pathname === "/blocks") {
    const input = await body(request), s = await snapshot(db);
    expectedRevision(input, s.state);
    const userId = user === "owner" ? person(input.userId) : user;
    const startLocal = text(input.startLocal, 16), endLocal = text(input.endLocal, 16);
    const start = localInstant(startLocal), end = localInstant(endLocal);
    const repeatUntil = input.repeatUntil ? text(input.repeatUntil, 10) : null;
    if (repeatUntil) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(repeatUntil) || !Number.isFinite(Date.parse(`${repeatUntil}T12:00Z`)) || repeatUntil < startLocal.slice(0, 10) ||
          repeatUntil > addLocalDays(startLocal, 364).slice(0, 10) || new Date(`${repeatUntil}T12:00Z`).toISOString().slice(0, 10) !== repeatUntil ||
          Date.parse(end) <= Date.parse(start) || Date.parse(end) - Date.parse(start) > 86400_000 ||
          Date.parse(start) > Date.now() + 366 * 86400_000) fail(400, "Weekly blocks need an end date within one year and a duration of at most 24 hours.");
      let lastEnd = end;
      for (let d = 7; addLocalDays(startLocal, d).slice(0, 10) <= repeatUntil; d += 7) {
        localInstant(addLocalDays(startLocal, d)); lastEnd = localInstant(addLocalDays(endLocal, d));
      }
      if (Date.parse(lastEnd) <= Date.now()) fail(400, "This weekly series has ended. Choose an end date with an upcoming class meeting.");
    } else futurePeriod(start, end);
    if (s.blocks.filter(b => b.userId === userId).length >= 200) fail(400, "Remove an old block before adding more (200 per person).");
    const item = { id: crypto.randomUUID(), userId, startLocal, endLocal, repeatUntil,
      reason: text(input.reason, 120), createdAt: new Date().toISOString() };
    await commit(db, s.state, mutation => [db.prepare(`INSERT INTO team_blocks (id, user_id, data) SELECT ?, ?, ? WHERE ${guard}`)
      .bind(item.id, userId, JSON.stringify(item), mutation)], blockNotifications(item, false, user === "owner" ? [userId] : ["owner"]));
    ctx.waitUntil(flushAlerts(env));
    return { saved: true };
  }
  if (request.method === "DELETE" && url.pathname.startsWith("/blocks/")) {
    const input = await body(request), s = await snapshot(db);
    expectedRevision(input, s.state);
    const item = s.blocks.find(b => b.id === url.pathname.slice(8));
    if (!item || (user !== "owner" && item.userId !== user)) fail(404, "Block not found.");
    await commit(db, s.state, mutation => [db.prepare(`DELETE FROM team_blocks WHERE id = ? AND ${guard}`).bind(item.id, mutation)], blockNotifications(item, true, user === "owner" ? [item.userId] : ["owner"]));
    ctx.waitUntil(flushAlerts(env));
    return { deleted: true };
  }
  if (request.method === "POST" && url.pathname === "/assignments") {
    owner(user);
    const input = await body(request), s = await snapshot(db);
    expectedRevision(input, s.state);
    if (!s.state.synced_at || Date.now() - Date.parse(s.state.synced_at) > 2 * 3600_000) fail(409, "Calendar data is over two hours old. Run a calendar sync before assigning work.");
    const employeeId = person(input.employeeId, true);
    const appointmentId = input.appointmentId ? text(input.appointmentId, 300) : null;
    const appointment = appointmentId && s.appointments.find(a => a.id === appointmentId);
    if (appointmentId && !appointment) fail(404, "Appointment not found. Refresh the calendar first.");
    if (appointment && appointment.acceptedEmployeeIds.includes(employeeId)) fail(409, "This person already accepted the Calendar invitation.");
    if (appointmentId && s.assignments.some(a => active(a) && a.appointmentId === appointmentId && a.employeeId === employeeId)) {
      fail(409, "This person already has an active offer for this appointment.");
    }
    const start = appointment ? appointment.start : localInstant(input.startLocal);
    const end = appointment ? appointment.end : localInstant(input.endLocal);
    futurePeriod(start, end);
    if (s.assignments.filter(a => active(a) && Date.parse(a.end) > Date.now()).length >= 200) fail(400, "There are already 200 active offers. Finish or cancel old offers first.");
    if (input.overrideConflicts !== undefined && typeof input.overrideConflicts !== "boolean") fail(400, "Choose whether to allow time conflicts.");
    if (!input.overrideConflicts) checkConflicts(employeeId, { start, end, appointmentId }, s);
    const item = { id: crypto.randomUUID(), employeeId, appointmentId,
      title: appointment ? appointment.title : text(input.title, 160),
      instructions: text(input.instructions ?? "", 2000, false), start, end,
      status: "pending", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      ...(input.overrideConflicts ? { conflictOverride: approveConflict({ start, end }) } : {}) };
    const devices = await db.prepare("SELECT COUNT(*) AS count FROM team_devices WHERE user_id = ?").bind(employeeId).first();
    await commit(db, s.state, mutation => [saveAssignment(db, item, mutation)], assignmentNotifications(item, "offered", [employeeId]));
    ctx.waitUntil(flushAlerts(env));
    return { saved: true, notification: devices.count
      ? "Offer saved. A notification was queued for their enabled devices."
      : "Offer saved. This employee has no devices enabled for notifications yet; they can see and accept it in their dashboard." };
  }
  if (request.method === "POST" && url.pathname.startsWith("/assignments/")) {
    const input = await body(request), s = await snapshot(db);
    expectedRevision(input, s.state);
    const item = s.assignments.find(a => a.id === url.pathname.slice(13));
    if (!item || (user !== "owner" && item.employeeId !== user)) fail(404, "Assignment not found.");
    if (input.overrideConflicts !== undefined) {
      owner(user);
      if (input.overrideConflicts !== true || input.status !== undefined) fail(400, "Approve the time conflict separately from an assignment response.");
      if (!active(item) || Date.parse(item.start) <= Date.now()) fail(409, "Only upcoming active offers can receive a conflict override.");
      await commit(db, s.state, mutation => [saveAssignment(db, {
        ...item, conflictOverride: approveConflict(item), updatedAt: new Date().toISOString(),
      }, mutation)], assignmentNotifications(item, "conflict", [item.employeeId]));
      ctx.waitUntil(flushAlerts(env));
      return { saved: true, notification: "Time conflict approved. The employee can now accept this offer; their response is still required." };
    }
    if (input.status === "cancelled") {
      owner(user);
      if (!active(item) || Date.parse(item.start) <= Date.now()) fail(409, "Only upcoming offers can be cancelled here. Past earnings are not changed.");
    } else {
      if (user !== item.employeeId || item.status !== "pending" || !["accepted", "declined"].includes(input.status)) fail(409, "Only the assigned employee can respond to a pending offer.");
      if (Date.parse(item.start) <= Date.now()) fail(409, "This offer has started or ended. Ask Smooth to review it.");
      if (input.status === "accepted") {
        if (!s.state.synced_at || Date.now() - Date.parse(s.state.synced_at) > 2 * 3600_000) fail(409, "Ask Smooth to sync Calendar before accepting this offer.");
        if (!hasConflictOverride(item)) checkConflicts(user, item, s, item.id);
      }
    }
    await commit(db, s.state, mutation => [saveAssignment(db, { ...item, status: input.status, updatedAt: new Date().toISOString() }, mutation)],
      assignmentNotifications(item, input.status, user === "owner" ? [item.employeeId] : ["owner"]));
    ctx.waitUntil(flushAlerts(env));
    return { saved: true };
  }
  if (request.method === "POST" && url.pathname === "/push/device/status") {
    const input = await body(request);
    let endpoint;
    try { endpoint = pushEndpoint(input.endpoint); } catch { fail(400, "This push endpoint is invalid or unsupported."); }
    const id = await tokenHash(endpoint);
    const device = await db.prepare("SELECT * FROM team_devices WHERE id = ? AND user_id = ?").bind(id, user).first();
    // Upgrade only an existing owned registration. A status check must never
    // turn notifications back on after the user disabled them.
    if (device && input.keys != null) {
      let keys;
      try { keys = await subscriptionKeys(input.keys); } catch { fail(400, "Reconnect notifications on this device to refresh its subscription."); }
      if (device.p256dh !== keys.p256dh || device.auth !== keys.auth) {
        await db.prepare("UPDATE team_devices SET p256dh = ?, auth = ? WHERE id = ? AND user_id = ?")
          .bind(keys.p256dh, keys.auth, id, user).run();
      }
    }
    return { registered: Boolean(device) };
  }
  if (["POST", "DELETE"].includes(request.method) && url.pathname === "/push/device") {
    const input = await body(request);
    let endpoint;
    try { endpoint = pushEndpoint(input.endpoint); } catch { fail(400, "This push endpoint is invalid or unsupported."); }
    const id = await tokenHash(endpoint);
    if (request.method === "DELETE") {
      await db.prepare("DELETE FROM team_devices WHERE id = ? AND user_id = ?").bind(id, user).run();
      return { removed: true };
    }
    if (!env.VAPID_JWK) fail(503, "Push notifications have not been configured.");
    let keys;
    try { keys = await subscriptionKeys(input.keys); } catch { fail(400, "This push subscription is invalid. Reconnect notifications on this device."); }
    const result = await db.prepare(`INSERT INTO team_devices (id, user_id, endpoint, created_at, p256dh, auth)
      SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM team_devices WHERE user_id = ?) < 3
      OR EXISTS (SELECT 1 FROM team_devices WHERE id = ? AND user_id = ?)
      ON CONFLICT(id) DO UPDATE SET created_at = excluded.created_at,
        p256dh = COALESCE(excluded.p256dh, team_devices.p256dh), auth = COALESCE(excluded.auth, team_devices.auth)
        WHERE team_devices.user_id = excluded.user_id`)
      .bind(id, user, endpoint, new Date().toISOString(), keys?.p256dh ?? null, keys?.auth ?? null, user, id, user).run();
    if (!result.meta.changes) fail(409, "This device is registered to another login, or you have three devices already. Disable notifications on an old device first.");
    return { registered: true };
  }
  if (request.method === "POST" && url.pathname === "/push/test") {
    const input = await body(request);
    if (!env.VAPID_JWK) fail(503, "Push notifications have not been configured.");
    if (!input.endpoint) fail(400, "Refresh the dashboard, then use Send test on the device you want to check.");
    let endpoint;
    try { endpoint = pushEndpoint(input.endpoint); } catch { fail(400, "This push endpoint is invalid or unsupported."); }
    const id = await tokenHash(endpoint);
    const device = await db.prepare("SELECT * FROM team_devices WHERE id = ? AND user_id = ?").bind(id, user).first();
    if (!device) fail(409, "Enable notifications on this device first.");
    let result;
    try { result = await deliverPush(endpoint, JSON.parse(env.VAPID_JWK), fetch, { kind: "test", keys: device.p256dh && device.auth ? { p256dh: device.p256dh, auth: device.auth } : null }); }
    catch { fail(502, "The notification service could not be reached. Try again shortly."); }
    if (result.expired) await db.prepare("DELETE FROM team_devices WHERE id = ? AND user_id = ?").bind(id, user).run();
    return { ...result, message: pushDeliveryMessage(result) };
  }
  fail(404, "Endpoint not found.");
}

const worker = {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("origin");
    const headers = { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff", Vary: "Origin" };
    if (origin && !origins.has(origin)) return new Response(JSON.stringify({ error: "Origin not allowed." }), { status: 403, headers });
    if (origin) headers["access-control-allow-origin"] = origin;
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...headers,
      "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS", "access-control-allow-headers": "Authorization, Content-Type", "access-control-max-age": "600" } });
    try { return new Response(JSON.stringify(await route(request, env, ctx)), { headers }); }
    catch (error) {
      const status = error instanceof ApiError ? error.status : 500;
      return new Response(JSON.stringify({ error: status === 500 ? "Scheduling is temporarily unavailable. Your change was not confirmed; refresh before retrying." : error.message }), { status, headers });
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(Promise.all([flushAlerts(env), sendQuizReminders(env)]));
  },
};
export default worker;
