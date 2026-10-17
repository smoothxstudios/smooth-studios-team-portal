import { getCalendarConfig, calendarAccessToken } from "./calendar-auth.mjs";

const guard = "EXISTS (SELECT 1 FROM team_state WHERE id = 1 AND mutation = ?)";
const active = item => ["pending", "accepted"].includes(item.status);
const normalize = value => typeof value === "string" ? value.trim().toLowerCase() : "";
const sameTime = (a, b) => Date.parse(a.start) === Date.parse(b.start?.dateTime ?? b.start) && Date.parse(a.end) === Date.parse(b.end?.dateTime ?? b.end);
const outcome = (status, code, googleStatus) => ({ status, code, ...(googleStatus ? { googleStatus } : {}) });
const statuses = new Set(["needsAction", "tentative", "accepted", "declined"]);
const markerKey = employeeId => `smoothAppGuest_${employeeId}`;

/** Queue within the same revision-guarded transaction as the assignment write. */
export function calendarQueueStatement(db, assignment, mutation) {
  return db.prepare(`INSERT INTO calendar_assignment_outbox
    (assignment_id, version, status, result, attempts, next_attempt_at, lease_until, updated_at)
    SELECT ?, ?, 'pending', NULL, 0, 0, 0, ? WHERE ${guard}
    ON CONFLICT(assignment_id) DO UPDATE SET version = excluded.version, status = 'pending', result = NULL,
      attempts = 0, next_attempt_at = 0, lease_until = 0, updated_at = excluded.updated_at`)
    .bind(assignment.id, crypto.randomUUID(), Date.now(), mutation);
}

/** Bind writes and acknowledgements to the exact, unexpired claim, even if its version is reclaimed. */
export function calendarDeliveryLease(db, row, until) {
  return {
    async current(now = Date.now()) {
      return Boolean(await db.prepare(`SELECT assignment_id FROM calendar_assignment_outbox
        WHERE assignment_id = ? AND version = ? AND lease_until = ? AND lease_until > ?`)
        .bind(row.assignment_id, row.version, until, now).first());
    },
    async acknowledge(result, now = Date.now()) {
      const attempts = row.attempts + 1;
      const next = result.status === "retrying" ? now + Math.min(3600_000, 30_000 * 2 ** Math.min(attempts, 7)) : 0;
      return db.prepare(`UPDATE calendar_assignment_outbox SET status = ?, result = ?, attempts = ?,
        next_attempt_at = ?, lease_until = 0, updated_at = ?
        WHERE assignment_id = ? AND version = ? AND lease_until = ? AND lease_until > ?`)
        .bind(result.status, JSON.stringify({ code: result.code, ...(statuses.has(result.googleStatus) ? { googleStatus: result.googleStatus } : {}) }),
          attempts, next, now, row.assignment_id, row.version, until, now).run();
    },
  };
}

function googleUrl(calendarId, eventId) {
  return new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ""}`);
}
async function google(fetcher, url, token, options = {}) {
  const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(15_000), ...options,
    headers: { authorization: `Bearer ${token.accessToken}`, ...(options.body ? { "content-type": "application/json" } : {}), ...options.headers } });
  if (!response.ok) return { status: response.status };
  try { return { status: response.status, event: await response.json() }; }
  catch { return { status: 502 }; }
}
function failure(status, subject = "owner") {
  if ([401, 403].includes(status)) return outcome("needs_connection", `${subject}_permission`);
  if ([404, 410].includes(status)) return outcome("stale", "event_removed");
  return outcome("retrying", "google_unavailable");
}
function eventProblem(event, assignment, organizer = true) {
  if (!event || event.status === "cancelled") return outcome("stale", "event_removed");
  if (!sameTime(assignment, event)) return outcome("stale", "time_changed");
  if (organizer && event.organizer?.self !== true) return outcome("needs_review", "organizer_copy_required");
  if (organizer && event.attendeesOmitted) return outcome("needs_review", "complete_guest_list_required");
  if (!event.etag) return outcome("retrying", "event_version_missing");
  return null;
}
function invitationFor(event, emails) {
  return (event.attendees ?? []).find(guest => emails.has(normalize(guest.email)));
}
function responseStatus(event, emails) {
  const responses = (event.attendees ?? []).filter(guest => emails.has(normalize(guest.email))).map(guest => guest.responseStatus ?? "needsAction");
  return ["accepted", "tentative", "needsAction", "declined"].find(status => responses.includes(status));
}
function privateMarker(event, employeeId) {
  const value = event.extendedProperties?.private?.[markerKey(employeeId)];
  if (value === undefined) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed.email === "string" && typeof parsed.assignmentId === "string" ? parsed : false;
  } catch { return false; }
}
function privateProperties(event, employeeId, value) {
  return { private: { ...(event.extendedProperties?.private ?? {}), [markerKey(employeeId)]: value === null ? null : JSON.stringify(value) } };
}
function unrelatedGuests(event, config, ownerToken) {
  const teamEmails = new Set(config.employees.flatMap(person => [person.email, ...(person.invitationEmails ?? [])]).map(normalize));
  teamEmails.add(normalize(ownerToken.email));
  teamEmails.add(normalize(event.organizer?.email));
  return (event.attendees ?? []).some(guest => !guest.organizer && !teamEmails.has(normalize(guest.email)));
}
function latestAssignment(assignment, assignments) {
  const pair = assignments.filter(item => item.appointmentId === assignment.appointmentId && item.employeeId === assignment.employeeId);
  const live = pair.filter(active);
  if (!active(assignment) && live.some(item => item.id !== assignment.id)) return false;
  const candidates = live.length ? live : pair;
  const latest = candidates.slice().sort((a, b) => Date.parse(b.createdAt ?? b.updatedAt) - Date.parse(a.createdAt ?? a.updatedAt) ||
    Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id))[0];
  return !latest || latest.id === assignment.id;
}

/** Network work is separate from queue storage so fixtures never send real invitations. */
export async function deliverCalendarAssignment({ assignment, assignments = [assignment], config, ownerToken, employeeToken,
  fetcher = fetch, now = Date.now(), isCurrent = async () => true }) {
  if (!assignment?.appointmentId || !["pending", "accepted", "declined", "cancelled"].includes(assignment.status)) return outcome("stale", "assignment_unavailable");
  if (!Number.isFinite(Date.parse(assignment.start)) || !Number.isFinite(Date.parse(assignment.end)) ||
      Date.parse(assignment.start) <= now || Date.parse(assignment.end) <= Date.parse(assignment.start)) return outcome("stale", "event_started");
  if (!latestAssignment(assignment, assignments)) return outcome("stale", "newer_assignment");
  if (!config?.calendarId) return outcome("needs_connection", "calendar_not_configured");
  const employee = config.employees.find(person => person.id === assignment.employeeId);
  if (!employee?.email) return outcome("needs_connection", "employee_not_configured");
  if (!ownerToken?.accessToken) return outcome("needs_connection", "owner_connection");
  const emails = new Set([employee.email, ...(employee.invitationEmails ?? [])].map(normalize).filter(Boolean));
  const newGuestEmail = employeeToken?.accessToken && emails.has(normalize(employeeToken.email)) ? normalize(employeeToken.email) : employee.email;
  let original;
  for (let attempt = 0; attempt < 3; attempt++) {
    const read = await google(fetcher, googleUrl(config.calendarId, assignment.appointmentId), ownerToken);
    if (!read.event) return failure(read.status);
    original = read.event;
    const problem = eventProblem(original, assignment);
    if (problem) return problem;
    const existing = invitationFor(original, emails), marker = privateMarker(original, employee.id);
    if (marker === false || (marker && !emails.has(normalize(marker.email)))) return outcome("needs_review", "guest_ownership_review");
    if (!existing && marker?.assignmentId === assignment.id && active(assignment)) return outcome("needs_review", "invitation_missing");
    let patch = null, guestChange = false;
    if (assignment.status === "cancelled") {
      if (assignment.removeCalendarGuest === true) {
        if ((original.attendees ?? []).some(guest => emails.has(normalize(guest.email)) && guest.organizer)) return outcome("needs_review", "organizer_guest");
        const attendees = (original.attendees ?? []).filter(guest => !emails.has(normalize(guest.email)));
        guestChange = attendees.length !== (original.attendees ?? []).length;
        if (!guestChange && !marker) return outcome("synced", "person_removed");
        patch = { ...(guestChange ? { attendees } : {}), extendedProperties: privateProperties(original, employee.id, null) };
      } else if (marker) {
        const attendees = (original.attendees ?? []).filter(guest => normalize(guest.email) !== normalize(marker.email));
        guestChange = attendees.length !== (original.attendees ?? []).length;
        patch = { ...(guestChange ? { attendees } : {}), extendedProperties: privateProperties(original, employee.id, null) };
      } else return outcome("synced", "existing_calendar_guest_preserved", responseStatus(original, emails));
    } else if (["pending", "accepted"].includes(assignment.status) && !existing) {
      patch = { attendees: [...(original.attendees ?? []), { email: newGuestEmail, responseStatus: "needsAction" }],
        extendedProperties: privateProperties(original, employee.id, { email: newGuestEmail, assignmentId: assignment.id }) };
      guestChange = true;
    } else if (marker && marker.assignmentId !== assignment.id && active(assignment)) {
      patch = { extendedProperties: privateProperties(original, employee.id, { ...marker, assignmentId: assignment.id }) };
    }
    if (!patch) break;
    if (guestChange && unrelatedGuests(original, config, ownerToken)) return outcome("needs_review", "guest_notifications_review", responseStatus(original, emails));
    if (!await isCurrent()) return outcome("stale", "assignment_changed");
    const url = googleUrl(config.calendarId, assignment.appointmentId);
    url.searchParams.set("sendUpdates", guestChange ? "all" : "none");
    const write = await google(fetcher, url, ownerToken, { method: "PATCH", headers: { "If-Match": original.etag }, body: JSON.stringify(patch) });
    if (write.status === 412) { if (attempt === 2) return outcome("retrying", "calendar_changed"); continue; }
    if (!write.event) return failure(write.status);
    original = write.event;
    const after = eventProblem(original, assignment);
    if (after) return after;
    if (assignment.status === "cancelled") return outcome("synced", assignment.removeCalendarGuest ? "person_removed" : "invitation_removed");
    break;
  }
  const currentResponse = responseStatus(original, emails);
  if (assignment.status === "pending") return outcome("synced", "invitation_synced", currentResponse);
  if (assignment.status === "cancelled") return outcome("synced", assignment.removeCalendarGuest ? "person_removed" : "invitation_removed");
  if (currentResponse === assignment.status) return outcome("synced", "response_confirmed", currentResponse);
  if (assignment.status === "declined" && !invitationFor(original, emails)) return outcome("synced", "no_calendar_invitation");
  if (!employeeToken?.accessToken || !emails.has(normalize(employeeToken.email))) return outcome("needs_connection", "employee_connection", currentResponse);
  const response = await writeOwnResponse({ assignment, original, employeeToken, emails, fetcher, isCurrent });
  if (response) return response;
  const verification = await google(fetcher, googleUrl(config.calendarId, assignment.appointmentId), ownerToken);
  if (!verification.event) return failure(verification.status);
  const problem = eventProblem(verification.event, assignment);
  if (problem) return problem;
  const verified = responseStatus(verification.event, emails);
  return verified === assignment.status ? outcome("synced", "response_confirmed", verified) : outcome("retrying", "response_propagating", verified);
}

async function writeOwnResponse({ assignment, original, employeeToken, emails, fetcher, isCurrent }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let read = await google(fetcher, googleUrl("primary", original.id), employeeToken);
    if ([404, 410].includes(read.status) && original.iCalUID) {
      const url = googleUrl("primary");
      url.searchParams.set("iCalUID", original.iCalUID);
      url.searchParams.set("timeMin", new Date(Date.parse(assignment.start) - 86400_000).toISOString());
      url.searchParams.set("timeMax", new Date(Date.parse(assignment.end) + 86400_000).toISOString());
      url.searchParams.set("singleEvents", "true"); url.searchParams.set("maxResults", "20");
      const list = await google(fetcher, url, employeeToken);
      if (!list.event) return failure(list.status, "employee");
      read = { status: 200, event: list.event.items?.find(event => event.iCalUID === original.iCalUID && sameTime(assignment, event)) };
    }
    if (!read.event) {
      if ([404, 410].includes(read.status) || read.status === 200) {
        const invited = invitationFor(original, emails);
        return normalize(invited?.email) !== normalize(employeeToken.email)
          ? outcome("needs_connection", "employee_calendar_address") : outcome("retrying", "invitation_propagating");
      }
      return failure(read.status, "employee");
    }
    const event = read.event;
    const problem = eventProblem(event, assignment, false);
    if (problem) return problem;
    if (normalize(event.organizer?.email) !== normalize(original.organizer?.email) ||
      (original.iCalUID && event.iCalUID !== original.iCalUID)) return outcome("needs_review", "employee_event_review");
    const self = (event.attendees ?? []).find(guest => guest.self && emails.has(normalize(guest.email)));
    if (!self) return outcome("needs_review", "employee_guest_review");
    if (self.responseStatus === assignment.status) return null;
    if (!await isCurrent()) return outcome("stale", "assignment_changed");
    const url = googleUrl("primary", event.id); url.searchParams.set("sendUpdates", "none");
    const write = await google(fetcher, url, employeeToken, { method: "PATCH", headers: { "If-Match": event.etag },
      body: JSON.stringify({ attendeesOmitted: true, attendees: [{ email: self.email, responseStatus: assignment.status }] }) });
    if (write.status === 412) { if (attempt === 2) return outcome("retrying", "calendar_changed"); continue; }
    if (!write.event) return failure(write.status, "employee");
    return null;
  }
  return outcome("retrying", "calendar_changed");
}

/** Deliver a bounded batch; optional integrations never fail an app assignment. */
export async function flushCalendarAssignments(env, { assignmentId, limit, fetcher = fetch } = {}) {
  const report = { processed: 0, synced: 0, needsConnection: 0, needsReview: 0, retrying: 0, stale: 0 };
  const db = env.DB, now = Date.now(), take = Math.max(1, Math.min(assignmentId ? 1 : 3, limit ?? 3));
  if (!db) return report;
  let rows;
  try {
    rows = (await db.prepare(`SELECT * FROM calendar_assignment_outbox WHERE lease_until <= ?
      AND ((status IN ('pending','retrying') AND next_attempt_at <= ?) OR status = 'needs_connection')
      ${assignmentId ? "AND assignment_id = ?" : ""} ORDER BY updated_at LIMIT ?`)
      .bind(now, now, ...(assignmentId ? [assignmentId] : []), take).all()).results;
  } catch { return report; }
  for (const row of rows) {
    const until = Date.now() + 180_000;
    const claim = await db.prepare(`UPDATE calendar_assignment_outbox SET lease_until = ?
      WHERE assignment_id = ? AND version = ? AND lease_until <= ?
      AND ((status IN ('pending','retrying') AND next_attempt_at <= ?) OR status = 'needs_connection')`)
      .bind(until, row.assignment_id, row.version, now, now).run();
    if (!claim.meta.changes) continue;
    const lease = calendarDeliveryLease(db, row, until);
    let result;
    try {
      const stored = await db.prepare("SELECT data FROM team_assignments WHERE id = ?").bind(row.assignment_id).first();
      const assignment = stored ? JSON.parse(stored.data) : null;
      const config = await getCalendarConfig(env);
      if (!assignment) result = outcome("stale", "assignment_unavailable");
      else if (!config) result = outcome("needs_connection", "calendar_not_configured");
      else {
        const all = (await db.prepare("SELECT data FROM team_assignments WHERE json_extract(data, '$.appointmentId') = ? AND employee_id = ?")
          .bind(assignment.appointmentId, assignment.employeeId).all()).results.map(item => JSON.parse(item.data));
        const ownerToken = await calendarAccessToken(env, "owner");
        const employeeToken = ownerToken && assignment.status !== "cancelled" ? await calendarAccessToken(env, assignment.employeeId) : null;
        result = await deliverCalendarAssignment({ assignment, assignments: all, config, ownerToken, employeeToken, fetcher, now: Date.now(),
          isCurrent: async () => {
            if (Date.parse(assignment.start) <= Date.now()) return false;
            if (!await lease.current()) return false;
            const fresh = (await db.prepare("SELECT data FROM team_assignments WHERE json_extract(data, '$.appointmentId') = ? AND employee_id = ?")
              .bind(assignment.appointmentId, assignment.employeeId).all()).results.map(item => JSON.parse(item.data));
            return latestAssignment(assignment, fresh);
          } });
      }
    } catch { result = outcome("retrying", "calendar_unavailable"); }
    const saved = await lease.acknowledge(result);
    if (!saved.meta.changes) continue;
    report.processed++;
    const key = { needs_connection: "needsConnection", needs_review: "needsReview" }[result.status] ?? result.status;
    report[key]++;
  }
  return report;
}
