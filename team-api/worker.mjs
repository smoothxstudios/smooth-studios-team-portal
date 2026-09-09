import { tokenHash } from "../lib/team-auth.mjs";
import { TEAM, localInstant as parseLocalInstant, addLocalDays, assignmentConflicts, hasConflictOverride } from "../lib/team-schedule.mjs";
import { flushAlerts, publicPushKey, pushEndpoint } from "./push.mjs";

const users = TEAM.map(p => p.id);
const origins = new Set(["https://smoothxstudios.github.io", "https://smooth-studios-team-portal.felixhansley.chatgpt.site"]);
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
async function commit(db, state, makeStatements, alertUsers = []) {
  const id = crypto.randomUUID();
  const statements = [db.prepare("UPDATE team_state SET revision = revision + 1, mutation = ? WHERE id = 1 AND revision = ?").bind(id, state.revision), ...makeStatements(id)];
  if (alertUsers.length) statements.push(db.prepare(`INSERT INTO team_alerts (user_id, id, attempts, due_at)
    SELECT value, ?, 0, ? FROM json_each(?) WHERE ${guard}
    ON CONFLICT(user_id) DO UPDATE SET id = excluded.id, attempts = 0, due_at = excluded.due_at`)
    .bind(id, Date.now(), JSON.stringify([...new Set(alertUsers)]), id));
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
  if (request.method === "GET" && url.pathname === "/health") {
    const ready = Boolean(env.TEAM_TOKEN_HASHES && db && await db.prepare("SELECT id FROM team_state WHERE id = 1").first());
    return { version: 1, ready, pushReady: Boolean(env.VAPID_JWK) };
  }
  const user = await authenticate(request, env);
  if (url.pathname.startsWith("/sync/")) syncOnly(user);
  else if (user === "sync") fail(403, "Sync access is restricted to synchronization endpoints.");

  if (request.method === "GET" && url.pathname === "/schedule") {
    const s = await snapshot(db), isOwner = user === "owner";
    const assignments = s.assignments.filter(a => isOwner || a.employeeId === user);
    const ids = new Set(assignments.filter(active).map(a => a.appointmentId));
    const devices = (await db.prepare("SELECT user_id, COUNT(*) AS count FROM team_devices GROUP BY user_id").all()).results;
    return { revision: s.state.revision, syncedAt: s.state.synced_at,
      appointments: s.appointments.filter(a => isOwner || ids.has(a.id) || a.acceptedEmployeeIds.includes(user))
        .map(a => isOwner ? a : { ...a, acceptedEmployeeIds: a.acceptedEmployeeIds.filter(id => id === user) }),
      blocks: s.blocks.filter(b => isOwner || b.userId === user), assignments,
      devices: Object.fromEntries(devices.filter(d => isOwner || d.user_id === user).map(d => [d.user_id, d.count])),
      pushPublicKey: env.VAPID_JWK ? publicPushKey(JSON.parse(env.VAPID_JWK)) : null,
    };
  }
  if (request.method === "GET" && url.pathname === "/sync/accepted") {
    const assignments = await jsonRows(db, "SELECT data FROM team_assignments");
    return { assignments: assignments
      .filter(a => a.status === "accepted" && a.appointmentId)
      .map(({ appointmentId, employeeId, start, end }) => ({ appointmentId, employeeId, start, end })),
      calendarAssignments: assignments.filter(a => a.appointmentId)
        .map(({ appointmentId, employeeId, start, end, status }) => ({ appointmentId, employeeId, start, end, status })),
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
    const changes = [], notify = [];
    const appointmentsById = new Map(next.map(a => [a.id, a]));
    for (const a of s.assignments.filter(a => a.appointmentId && active(a))) {
      const appointment = appointmentsById.get(a.appointmentId);
      if (!appointment) {
        changes.push({ ...a, status: "cancelled", note: "Appointment removed from Calendar.", updatedAt: new Date().toISOString() });
        notify.push(a.employeeId);
      } else if (Date.parse(a.start) !== Date.parse(appointment.start) || Date.parse(a.end) !== Date.parse(appointment.end)) {
        const status = Date.parse(appointment.start) > Date.now() ? "pending" : "cancelled";
        changes.push({ ...a, start: appointment.start, end: appointment.end, status, conflictOverride: undefined,
          note: status === "pending" ? "Calendar time changed. Please accept the new time." : "Time changed to a past appointment. Smooth must review it.", updatedAt: new Date().toISOString() });
        notify.push(a.employeeId);
      }
    }
    await commit(db, s.state, mutation => [
      db.prepare(`UPDATE team_state SET generation = ?, synced_at = ? WHERE id = 1 AND ${guard}`).bind(generation, new Date().toISOString(), mutation),
      db.prepare(`UPDATE team_assignments SET data = (SELECT value FROM json_each(?) WHERE json_extract(value, '$.id') = team_assignments.id)
        WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?)) AND ${guard}`)
        .bind(JSON.stringify(changes), JSON.stringify(changes), mutation),
    ], notify.length ? [...notify, "owner"] : []);
    // The old snapshot remains available until the atomic generation switch.
    await db.prepare("DELETE FROM team_appointments WHERE generation != ?").bind(generation).run();
    if (notify.length) ctx.waitUntil(flushAlerts(env));
    return { synced: next.length };
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
      .bind(item.id, userId, JSON.stringify(item), mutation)], user === "owner" ? [userId] : ["owner"]);
    ctx.waitUntil(flushAlerts(env));
    return { saved: true };
  }
  if (request.method === "DELETE" && url.pathname.startsWith("/blocks/")) {
    const input = await body(request), s = await snapshot(db);
    expectedRevision(input, s.state);
    const item = s.blocks.find(b => b.id === url.pathname.slice(8));
    if (!item || (user !== "owner" && item.userId !== user)) fail(404, "Block not found.");
    await commit(db, s.state, mutation => [db.prepare(`DELETE FROM team_blocks WHERE id = ? AND ${guard}`).bind(item.id, mutation)], user === "owner" ? [item.userId] : ["owner"]);
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
    await commit(db, s.state, mutation => [saveAssignment(db, item, mutation)], [employeeId]);
    ctx.waitUntil(flushAlerts(env));
    return { saved: true, notification: "Queued for enabled devices; delivery is not guaranteed. The offer is visible in the portal now." };
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
      }, mutation)], [item.employeeId]);
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
      user === "owner" ? [item.employeeId] : ["owner"]);
    ctx.waitUntil(flushAlerts(env));
    return { saved: true };
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
    const result = await db.prepare(`INSERT INTO team_devices (id, user_id, endpoint, created_at)
      SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM team_devices WHERE user_id = ?) < 3
      OR EXISTS (SELECT 1 FROM team_devices WHERE id = ? AND user_id = ?)
      ON CONFLICT(id) DO UPDATE SET created_at = excluded.created_at WHERE team_devices.user_id = excluded.user_id`)
      .bind(id, user, endpoint, new Date().toISOString(), user, id, user).run();
    if (!result.meta.changes) fail(409, "This device is registered to another login, or you have three devices already. Disable notifications on an old device first.");
    return { registered: true };
  }
  if (request.method === "POST" && url.pathname === "/push/test") {
    await body(request);
    const device = await db.prepare("SELECT id FROM team_devices WHERE user_id = ? LIMIT 1").bind(user).first();
    if (!device) fail(409, "Enable notifications on this device first.");
    await db.prepare(`INSERT INTO team_alerts (user_id, id, attempts, due_at) VALUES (?, ?, 0, ?)
      ON CONFLICT(user_id) DO UPDATE SET id = excluded.id, attempts = 0, due_at = excluded.due_at WHERE team_alerts.due_at < ?`)
      .bind(user, crypto.randomUUID(), Date.now(), Date.now() - 60_000).run();
    ctx.waitUntil(flushAlerts(env));
    return { queued: true };
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
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS", "access-control-allow-headers": "Authorization, Content-Type", "access-control-max-age": "600" } });
    try { return new Response(JSON.stringify(await route(request, env, ctx)), { headers }); }
    catch (error) {
      const status = error instanceof ApiError ? error.status : 500;
      return new Response(JSON.stringify({ error: status === 500 ? "Scheduling is temporarily unavailable. Your change was not confirmed; refresh before retrying." : error.message }), { status, headers });
    }
  },
  async scheduled(_event, env, ctx) { ctx.waitUntil(flushAlerts(env)); },
};
export default worker;
