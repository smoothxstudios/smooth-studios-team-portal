import { tokenHash } from "../lib/team-auth.mjs";
import { TEAM, localInstant as parseLocalInstant, addLocalDays, assignmentConflicts, hasConflictOverride } from "../lib/team-schedule.mjs";
import { deliverPush, flushAlerts, publicPushKey, pushDeliveryMessage, pushEndpoint } from "./push.mjs";
import { engagementRoute } from "./engagement.mjs";
import { subscriptionKeys } from "./push-encryption.mjs";
import { sendQuizReminders } from "./quiz-notifications.mjs";
import { assignmentNotifications, blockNotifications } from "./notification-content.mjs";
import { creativeWorkRoute } from "./creative-work.mjs";
import { alertsRoute } from "./alerts.mjs";
import { dashboardLayoutRoute } from "./dashboard-layout.mjs";
import { payrollRoute } from "./payroll.mjs";
import { studioReferenceRoute } from "./studio-reference.mjs";
import { CALENDAR_INVITATION_STATUSES } from "../lib/calendar-invitations.mjs";
import { calendarAuthRoute } from "./calendar-auth.mjs";
import { calendarQueueStatement, calendarDurationImportStatement, flushCalendarAssignments } from "./calendar-delivery.mjs";
import { calendarTimeChange, recoverDurationCancellation, LEGACY_PAST_NOTE } from "./calendar-time-changes.mjs";
import { manualNoticesRoute } from "./manual-notices.mjs";
import { withoutRemovedRentalStaff } from "../lib/rental-staff.mjs";
import { calendarRecord, calendarKey, recordManifest, verifyDelta, recordBatches } from "../lib/sync-records.mjs";
import { trackImport, cleanImports } from "./sync-storage.mjs";

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
    .bind(Date.now(), JSON.stringify(notifications.map(({ userId, kind, title, body, target, targetId, personId }) => ({
      id: crypto.randomUUID(), userId, kind, payload: JSON.stringify({ title, body, target, targetId, personId }),
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
  if (request.method === "GET" && ["/calendar/oauth/start", "/calendar/oauth/callback"].includes(url.pathname)) {
    const result = await calendarAuthRoute({ request, env, user: null, body, fail });
    if (url.pathname.endsWith("/callback")) ctx.waitUntil(flushCalendarAssignments(env, { limit: 3 }));
    return result;
  }
  if (request.method === "GET" && url.pathname === "/studio-reference/key") {
    if (!env.STUDIO_REFERENCE_KEY) fail(503, "Secure import is not ready.");
    const { kty, n, e } = JSON.parse(env.STUDIO_REFERENCE_KEY);
    return { publicKey: { kty, n, e, alg: "RSA-OAEP-256", key_ops: ["encrypt"], ext: true } };
  }
  if (request.method === "GET" && url.pathname === "/health") {
    const ready = Boolean(env.TEAM_TOKEN_HASHES && db && await db.prepare("SELECT id FROM team_state WHERE id = 1").first());
    return { version: 1, ready, pushReady: Boolean(env.VAPID_JWK), identityVersion: 1, availabilityVersion: 1, engagementVersion: 5, notificationVersion: 3, creativeWorkVersion: 2, studioReferenceVersion: 1, payrollVersion: 1, alertsVersion: 3, calendarInvitationsVersion: 1, calendarDeliveryVersion: 1, manualNoticesVersion: 1, reminderTemplatesVersion: 1, dashboardLayoutVersion: 1, rentalStaffVersion: 1, rentalTimeVersion: 1, incrementalSyncVersion: 1 };
  }
  const user = await authenticate(request, env);
  if (url.pathname.startsWith("/sync/")) syncOnly(user);
  else if (user === "sync") fail(403, "Sync access is restricted to synchronization endpoints.");
  if (["/notifications", "/notifications/sent"].includes(url.pathname) || /^\/assignments\/[^/]+\/remind$/.test(url.pathname)) return manualNoticesRoute({ request, env, user, body, fail, ctx });
  if (url.pathname.startsWith("/calendar/")) return calendarAuthRoute({ request, env, user, body, fail });
  if (request.method === "POST" && url.pathname === "/sync/calendar/configuration") {
    const input = await body(request);
    const calendarId = text(input.calendarId, 500);
    if (calendarId.includes("/") || /\s/.test(calendarId) || !Array.isArray(input.employees) || input.employees.length > users.length - 1) fail(400, "Invalid Calendar delivery configuration.");
    const ids = new Set(), emails = new Set();
    const employees = input.employees.map(entry => {
      if (!entry || typeof entry !== "object") fail(400, "Invalid Calendar team member.");
      const id = person(entry.id, true);
      if (ids.has(id)) fail(400, "Duplicate Calendar team member.");
      ids.add(id);
      if (!Array.isArray(entry.invitationEmails) || !entry.invitationEmails.length || entry.invitationEmails.length > 10) fail(400, "Check the Calendar invitation addresses.");
      const invitationEmails = [...new Set(entry.invitationEmails.map(value => {
        const email = text(value, 254).toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || emails.has(email)) fail(400, "Calendar invitation addresses must belong to one person.");
        return email;
      }))];
      invitationEmails.forEach(email => emails.add(email));
      const email = text(entry.email, 254).toLowerCase();
      if (!invitationEmails.includes(email)) fail(400, "The primary invitation address must be a configured alias.");
      return { id, email, invitationEmails };
    });
    await db.prepare("INSERT INTO calendar_sync_config (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data WHERE calendar_sync_config.data != excluded.data")
      .bind(JSON.stringify({ calendarId, employees })).run();
    return { saved: true };
  }
  if (url.pathname === "/alerts" || url.pathname.startsWith("/alerts/")) return alertsRoute({ request, db, user, body, fail });
  if (url.pathname === "/dashboard-layout") return dashboardLayoutRoute({ request, db, user, body, fail });
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
    const calendarRows = (await db.prepare(`SELECT q.assignment_id, q.status, q.result, q.updated_at FROM calendar_assignment_outbox q
      JOIN team_assignments a ON a.id = q.assignment_id WHERE ? = 'owner' OR a.employee_id = ?`).bind(user, user).all()).results;
    const assignments = s.assignments.filter(a => isOwner || a.employeeId === user).map(assignment => {
      const row = calendarRows.find(item => item.assignment_id === assignment.id);
      if (!row) return assignment;
      let result = {}; try { result = JSON.parse(row.result ?? "{}"); } catch { /* Keep a safe pending status. */ }
      let deliveryStatus = row.status;
      // A later Calendar import wins over an older outbound confirmation.
      if (row.status === "synced" && Date.parse(s.state.synced_at) > row.updated_at && !["invitation_removed", "person_removed", "no_calendar_invitation"].includes(result.code)) {
        const invitation = s.appointments.find(appointment => appointment.id === assignment.appointmentId)?.calendarInvitations?.find(item => item.employeeId === assignment.employeeId);
        result.googleStatus = invitation?.status;
        if (!invitation && assignment.status !== "cancelled") { deliveryStatus = "needs_review"; result.code = "invitation_missing"; }
      }
      return { ...assignment, calendarSync: { status: deliveryStatus, checkedAt: row.updated_at,
        ...(typeof result.code === "string" ? { code: result.code } : {}),
        ...(["accepted", "declined", "needsAction", "tentative", "removed"].includes(result.googleStatus) ? { googleStatus: result.googleStatus } : {}) } };
    });
    const ids = new Set(assignments.filter(active).map(a => a.appointmentId));
    const devices = (await db.prepare("SELECT user_id, COUNT(*) AS count FROM team_devices GROUP BY user_id").all()).results;
    const workPreferences = user === "owner"
      ? await jsonRows(db, "SELECT data FROM team_work_preferences")
      : await jsonRows(db, "SELECT data FROM team_work_preferences WHERE user_id = ?", user);
    return { revision: s.state.revision, syncedAt: s.state.synced_at, availabilityVersion: 1, workPreferences,
      appointments: s.appointments.map(a => withoutRemovedRentalStaff(a, assignments, s.state.synced_at)).filter(a => isOwner || ids.has(a.id) || a.acceptedEmployeeIds.includes(user) ||
          a.calendarInvitations?.some(invitation => invitation.employeeId === user && invitation.status !== "declined"))
        .map(a => isOwner ? a : { ...a, acceptedEmployeeIds: a.acceptedEmployeeIds.filter(id => id === user),
          calendarInvitations: (a.calendarInvitations ?? []).filter(invitation => invitation.employeeId === user) }),
      blocks: s.blocks.filter(b => isOwner || b.userId === user), assignments,
      devices: Object.fromEntries(devices.filter(d => isOwner || d.user_id === user).map(d => [d.user_id, d.count])),
      pushPublicKey: env.VAPID_JWK ? publicPushKey(JSON.parse(env.VAPID_JWK)) : null,
    };
  }
  if (request.method === "POST" && url.pathname === "/rental-staff/remove") {
    owner(user);
    const input = await body(request), s = await snapshot(db);
    expectedRevision(input, s.state);
    const employeeId = person(input.employeeId, true), appointmentId = text(input.appointmentId, 300);
    const appointment = s.appointments.find(item => item.id === appointmentId);
    if (!appointment) fail(404, "This rental is no longer available. Refresh the schedule.");
    if (input.start !== appointment.start || input.end !== appointment.end) fail(409, "The rental time changed. Refresh and review it before removing anyone.");
    futurePeriod(appointment.start, appointment.end);
    const offers = s.assignments.filter(item => item.appointmentId === appointmentId && item.employeeId === employeeId &&
      Date.parse(item.start) === Date.parse(appointment.start) && Date.parse(item.end) === Date.parse(appointment.end));
    const existing = offers.filter(item => item.removeCalendarGuest && item.status === "cancelled").sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    if (existing && !offers.some(active)) {
      const delivery = await db.prepare("SELECT status, result, updated_at FROM calendar_assignment_outbox WHERE assignment_id = ?").bind(existing.id).first();
      const reInvited = delivery?.status === "synced" && Date.parse(s.state.synced_at) > delivery.updated_at &&
        (appointment.acceptedEmployeeIds.includes(employeeId) || appointment.calendarInvitations?.some(item => item.employeeId === employeeId));
      if (!reInvited) return { saved: true, removedAssignment: existing, notification: "Person removed from this rental in the app. Check the Google Calendar removal status below." };
    }
    if (!offers.length && !appointment.acceptedEmployeeIds.includes(employeeId) &&
        !appointment.calendarInvitations?.some(item => item.employeeId === employeeId)) fail(404, "This person is not on this rental.");
    const now = new Date(Math.max(Date.now(), ...offers.map(item => (Date.parse(item.createdAt) || 0) + 1))).toISOString();
    const removed = { id: crypto.randomUUID(), employeeId, appointmentId, title: appointment.title, instructions: "",
      start: appointment.start, end: appointment.end, status: "cancelled", createdAt: now, updatedAt: now,
      removeCalendarGuest: true, note: "Removed from this rental by Smooth." };
    await commit(db, s.state, mutation => [
      ...offers.filter(active).map(item => saveAssignment(db, { ...item, status: "cancelled", updatedAt: now }, mutation)),
      saveAssignment(db, removed, mutation), calendarQueueStatement(db, removed, mutation),
    ], assignmentNotifications(removed, "cancelled", [employeeId]));
    ctx.waitUntil(flushAlerts(env));
    ctx.waitUntil(flushCalendarAssignments(env, { assignmentId: removed.id, limit: 1 }));
    return { saved: true, removedAssignment: removed, notification: "Person removed from this rental in the app. Check the Google Calendar removal status below." };
  }
  if (request.method === "GET" && url.pathname === "/sync/manifest") {
    await cleanImports(db, 'calendar');
    const state = await db.prepare("SELECT generation, synced_at FROM team_state WHERE id = 1").first();
    const rows = await jsonRows(db, "SELECT data FROM team_appointments WHERE generation = ?", state.generation);
    return { ...await recordManifest(rows.map(calendarRecord), calendarKey), generation: state.generation, syncedAt: state.synced_at };
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
      durationRecovery: { restored: assignments.filter(a => a.calendarChange?.kind === "duration_recovered").length,
        needsReview: assignments.filter(a => a.status === "cancelled" && a.note === LEGACY_PAST_NOTE && !a.calendarChange).length },
      pushDiagnostics: { registeredDevices: devices.count, queuedAlerts: alerts.count, retryingAlerts: alerts.retrying },
    };
  }
  if (request.method === "POST" && url.pathname === "/sync/import") {
    const input = await body(request), generation = text(input.generation, 80);
    if (!Array.isArray(input.appointments) || input.appointments.length > 100) fail(400, "Import up to 100 appointments at a time.");
    const appointments = input.appointments.map(a => {
      if (!Number.isFinite(Date.parse(a.start)) || !Number.isFinite(Date.parse(a.end)) || Date.parse(a.end) <= Date.parse(a.start) ||
          !Number.isInteger(a.priceCents) || a.priceCents < 0 || !Array.isArray(a.acceptedEmployeeIds)) fail(400, "Invalid appointment snapshot.");
      if (a.calendarInvitations !== undefined && (!Array.isArray(a.calendarInvitations) || a.calendarInvitations.length > users.length)) fail(400, "Invalid Calendar invitation snapshot.");
      const calendarInvitations = (a.calendarInvitations ?? []).map(invitation => {
        if (!invitation || !CALENDAR_INVITATION_STATUSES.includes(invitation.status)) fail(400, "Invalid Calendar invitation response.");
        return { employeeId: person(invitation.employeeId, true), status: invitation.status };
      });
      if (new Set(calendarInvitations.map(invitation => invitation.employeeId)).size !== calendarInvitations.length) fail(400, "Repeated Calendar invitation.");
      return calendarRecord({ id: text(a.id, 300), title: text(a.title, 300), customer: text(a.customer, 200, false),
        start: new Date(a.start).toISOString(), end: new Date(a.end).toISOString(), priceCents: a.priceCents,
        rentalDetails: text(a.rentalDetails ?? "", 8000, false),
        acceptedEmployeeIds: [...new Set(a.acceptedEmployeeIds.map(p => person(p, true)))],
        calendarInvitations,
      });
    });
    const state = await db.prepare("SELECT generation FROM team_state WHERE id = 1").first();
    if (state.generation === generation) fail(409, "Create a new import generation.");
    if (input.incremental === true) await trackImport(db, 'calendar', generation);
    await db.prepare(`INSERT INTO team_appointments (generation, id, data)
      SELECT ?, json_extract(value, '$.id'), value FROM json_each(?) WHERE true
      ON CONFLICT(generation, id) DO UPDATE SET data = excluded.data WHERE team_appointments.data != excluded.data`).bind(generation, JSON.stringify(appointments)).run();
    return { imported: appointments.length };
  }
  if (request.method === "POST" && url.pathname === "/sync/commit") {
    const input = await body(request), generation = text(input.generation, 80), s = await snapshot(db);
    const calendarReadAt = input.calendarReadAt === undefined ? new Date(Date.now()).toISOString() : text(input.calendarReadAt, 40);
    if (!Number.isFinite(Date.parse(calendarReadAt)) || Date.parse(calendarReadAt) > Date.now() + 60_000 || Date.parse(calendarReadAt) < Date.now() - 86400_000) fail(400, "Invalid Calendar read time.");
    const staged = await jsonRows(db, "SELECT data FROM team_appointments WHERE generation = ?", generation);
    let next = staged, syncStats;
    if (input.incremental === true) {
      if (generation === s.state.generation || input.baseGeneration !== s.state.generation || input.baseSyncedAt !== s.state.synced_at ||
          (s.state.synced_at && Date.parse(calendarReadAt) <= Date.parse(s.state.synced_at))) fail(409, "A newer Calendar sync is already saved. Retry with a fresh Calendar read.");
      const verified = await verifyDelta(s.appointments.map(calendarRecord), staged.map(calendarRecord), input, calendarKey, fail);
      next = verified.records; syncStats = verified.stats;
    }
    if (!Number.isInteger(input.count) || next.length !== input.count) fail(409, "The calendar import is incomplete.");
    const changes = [], notifications = [], corrections = [], now = Date.now();
    const queuedIds = new Set((await db.prepare("SELECT assignment_id FROM calendar_assignment_outbox").all()).results.map(row => row.assignment_id));
    const appointmentsById = new Map(next.map(a => [a.id, a]));
    const repairCandidates = s.assignments.filter(a => a.appointmentId && a.status === "cancelled" && a.note === LEGACY_PAST_NOTE && !a.calendarChange);
    const history = repairCandidates.length ? (await db.prepare("SELECT * FROM team_inbox WHERE target = 'scheduling' AND target_id IN (SELECT value FROM json_each(?))")
      .bind(JSON.stringify(repairCandidates.map(a => a.id))).all()).results : [];
    for (const a of s.assignments.filter(a => a.appointmentId && active(a))) {
      const appointment = appointmentsById.get(a.appointmentId);
      const change = calendarTimeChange(a, appointment, now);
      if (!change) continue;
      changes.push(change.assignment);
      notifications.push(...assignmentNotifications(change.assignment, change.event, [a.employeeId, "owner"]));
    }
    for (const a of repairCandidates) {
      const recovered = recoverDurationCancellation(a, appointmentsById.get(a.appointmentId), s.assignments, history, now);
      if (!recovered) continue;
      changes.push(recovered.assignment);
      // Correct the existing cancellation message in place, retaining its read
      // and deletion state. Recovery does not send or replay any notification.
      corrections.push(...recovered.correctedAlerts.map(alert => ({ ...alert,
        ...assignmentNotifications(recovered.assignment, "duration", [alert.userId])[0] })));
    }
    const importedDuration = assignment => ["duration", "duration_recovered"].includes(assignment.calendarChange?.kind) && Date.parse(assignment.start) <= now;
    await commit(db, s.state, mutation => [
      db.prepare(`UPDATE team_state SET generation = ?, synced_at = ? WHERE id = 1 AND ${guard}`)
        .bind(input.incremental === true ? s.state.generation : generation, calendarReadAt, mutation),
      ...(input.incremental === true ? [
        ...recordBatches(staged).map(rows => db.prepare(`INSERT INTO team_appointments(generation, id, data)
          SELECT ?, json_extract(value, '$.id'), value FROM json_each(?) WHERE ${guard}
          ON CONFLICT(generation, id) DO UPDATE SET data = excluded.data WHERE team_appointments.data != excluded.data`)
          .bind(s.state.generation, JSON.stringify(rows), mutation)),
        db.prepare(`DELETE FROM team_appointments WHERE generation = ? AND id IN (SELECT value FROM json_each(?)) AND ${guard}`)
          .bind(s.state.generation, JSON.stringify(input.removed), mutation),
        db.prepare(`DELETE FROM team_appointments WHERE generation = ? AND ${guard}`).bind(generation, mutation),
        db.prepare(`DELETE FROM sync_imports WHERE kind = 'calendar' AND generation = ? AND ${guard}`).bind(generation, mutation),
      ] : []),
      db.prepare(`UPDATE team_assignments SET data = (SELECT value FROM json_each(?) WHERE json_extract(value, '$.id') = team_assignments.id)
        WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?)) AND ${guard}`)
        .bind(JSON.stringify(changes), JSON.stringify(changes), mutation),
      ...changes.filter(assignment => queuedIds.has(assignment.id)).map(assignment => importedDuration(assignment)
        ? calendarDurationImportStatement(db, assignment, appointmentsById.get(assignment.appointmentId), mutation)
        : calendarQueueStatement(db, assignment, mutation)),
      ...corrections.map(alert => db.prepare(`UPDATE team_inbox SET title = ?, body = ? WHERE id = ? AND ${guard}`)
        .bind(alert.title, alert.body, alert.id, mutation)),
      db.prepare(`DELETE FROM team_notification_events WHERE id IN (SELECT value FROM json_each(?)) AND ${guard}`)
        .bind(JSON.stringify(corrections.map(alert => alert.id)), mutation),
    ], notifications);
    // The old snapshot remains available until the atomic generation switch.
    if (input.incremental !== true) await db.prepare("DELETE FROM team_appointments WHERE generation != ?").bind(generation).run();
    if (notifications.length) ctx.waitUntil(flushAlerts(env));
    if (changes.some(assignment => queuedIds.has(assignment.id) && !importedDuration(assignment))) ctx.waitUntil(flushCalendarAssignments(env, { limit: 3 }));
    return { synced: next.length, ...(syncStats ? { syncStats } : {}) };
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
    await commit(db, s.state, mutation => [saveAssignment(db, item, mutation),
      ...(item.appointmentId ? [calendarQueueStatement(db, item, mutation)] : [])], assignmentNotifications(item, "offered", [employeeId]));
    ctx.waitUntil(flushAlerts(env));
    if (item.appointmentId) ctx.waitUntil(flushCalendarAssignments(env, { assignmentId: item.id, limit: 1 }));
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
    const updated = { ...item, status: input.status, updatedAt: new Date().toISOString() };
    await commit(db, s.state, mutation => [saveAssignment(db, updated, mutation),
      ...(updated.appointmentId ? [calendarQueueStatement(db, updated, mutation)] : [])],
      assignmentNotifications(item, input.status, user === "owner" ? [item.employeeId] : ["owner"]));
    ctx.waitUntil(flushAlerts(env));
    if (updated.appointmentId) ctx.waitUntil(flushCalendarAssignments(env, { assignmentId: updated.id, limit: 1 }));
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
    try {
      const result = await route(request, env, ctx);
      if (result instanceof Response) {
        const responseHeaders = new Headers(headers);
        result.headers.forEach((value, name) => responseHeaders.set(name, value));
        return new Response(result.body, { status: result.status, headers: responseHeaders });
      }
      return new Response(JSON.stringify(result), { headers });
    }
    catch (error) {
      const status = error instanceof ApiError ? error.status : 500;
      return new Response(JSON.stringify({ error: status === 500 ? "Scheduling is temporarily unavailable. Your change was not confirmed; refresh before retrying." : error.message }), { status, headers });
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(Promise.all([flushAlerts(env), sendQuizReminders(env), flushCalendarAssignments(env, { limit: 3 })]));
  },
};
export default worker;
