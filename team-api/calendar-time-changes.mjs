import { STUDIO_ZONE, localInstant } from "../lib/team-schedule.mjs";
import { assignmentNotifications } from "./notification-content.mjs";

export const LEGACY_PAST_NOTE = "Time changed to a past appointment. Smooth must review it.";
const active = item => ["pending", "accepted"].includes(item.status);
const same = (a, b) => Date.parse(a) === Date.parse(b);
const durationNote = status => status === "accepted"
  ? "Rental duration updated. Your acceptance is unchanged."
  : "Rental duration updated. This offer is still awaiting your response.";

/** A duration correction is the same booking, even after it has started/ended. */
export function calendarTimeChange(assignment, appointment, now = Date.now()) {
  if (!active(assignment) || !assignment.appointmentId) return null;
  let event, status, note;
  if (!appointment) {
    event = "removed"; status = "cancelled"; note = "Appointment removed from Calendar.";
  } else if (same(assignment.start, appointment.start) && same(assignment.end, appointment.end)) return null;
  else if (same(assignment.start, appointment.start)) {
    event = "duration"; status = assignment.status; note = durationNote(status);
  } else {
    status = Date.parse(appointment.start) > now ? "pending" : "cancelled";
    event = status === "pending" ? "rescheduled" : "past";
    note = status === "pending" ? "Calendar time changed. Please accept the new time." : LEGACY_PAST_NOTE;
  }
  return { event, assignment: { ...assignment, ...(appointment ? { start: appointment.start, end: appointment.end } : {}),
    status, note, conflictOverride: undefined, updatedAt: new Date(now).toISOString(),
    calendarChange: { kind: event, previousStart: assignment.start, previousEnd: assignment.end,
      previousStatus: assignment.status, changedAt: new Date(now).toISOString() } } };
}

const date = new Intl.DateTimeFormat("en-CA", { timeZone: STUDIO_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
function originalEnd(assignment, body) {
  // Recover only the old same-day notification format; anything ambiguous is
  // left for manual review. Full regenerated-message equality below proves the
  // original start, title, recipient and response, not just this extracted end.
  const match = body.match(/–(\d{1,2}):(\d{2}) (AM|PM) (?:EST|EDT)\./);
  if (!match || +match[1] < 1 || +match[1] > 12 || +match[2] > 59) return null;
  const parts = Object.fromEntries(date.formatToParts(new Date(assignment.start)).map(p => [p.type, p.value]));
  const hour = (+match[1] % 12) + (match[3] === "PM" ? 12 : 0);
  try { return localInstant(`${parts.year}-${parts.month}-${parts.day}T${String(hour).padStart(2, "0")}:${match[2]}`); }
  catch { return null; }
}

/** Repair only the legacy duration-cancellation bug with an exact history match.
 * Never infer acceptance from a Calendar guest or revive an intentional removal.
 * Inbox tombstones remain usable as evidence without undeleting any alerts.
 */
export function recoverDurationCancellation(assignment, appointment, assignments, inbox, now = Date.now()) {
  if (assignment.status !== "cancelled" || assignment.note !== LEGACY_PAST_NOTE || assignment.calendarChange || assignment.removeCalendarGuest ||
    !appointment || !same(assignment.start, appointment.start) || !same(assignment.end, appointment.end)) return null;
  const cancelledAt = Date.parse(assignment.updatedAt), createdAt = Date.parse(assignment.createdAt);
  if (!Number.isFinite(cancelledAt) || !Number.isFinite(createdAt) || cancelledAt < createdAt ||
    !Number.isFinite(Date.parse(assignment.start)) || !Number.isFinite(Date.parse(assignment.end))) return null;
  if (assignments.some(other => other.id !== assignment.id && other.employeeId === assignment.employeeId && other.appointmentId === assignment.appointmentId &&
    (active(other) || Date.parse(other.createdAt) >= cancelledAt || Date.parse(other.updatedAt) >= cancelledAt))) return null;
  const history = inbox.filter(row => row.target === "scheduling" && row.target_id === assignment.id &&
    ((["owner", assignment.employeeId].includes(row.user_id) && row.kind === "schedule") ||
      (row.user_id === assignment.employeeId && row.kind === "assignment")))
    .sort((a, b) => b.created_at - a.created_at || b.sequence - a.sequence);
  const cancellations = history.filter(row => {
    const expected = assignmentNotifications(assignment, "past", [row.user_id], { legacyTimezone: true })[0];
    return row.title === expected.title && row.body === expected.body && row.created_at >= cancelledAt && row.created_at <= cancelledAt + 5000;
  });
  if (!cancellations.length || history.some(row => row.created_at >= cancelledAt && !cancellations.includes(row))) return null;
  const previous = history.filter(row => row.created_at < cancelledAt && row.created_at >= createdAt);
  // Conflict approvals don't change a response. A later reschedule, decline or
  // explicit cancellation must not be skipped in search of an older acceptance.
  const evidence = previous.find(row => row.title !== "Time conflict approved");
  if (!evidence) return null;
  const end = originalEnd(assignment, evidence.body);
  if (!end || Date.parse(end) <= Date.parse(assignment.start) || Date.parse(end) >= Date.parse(appointment.end)) return null;
  const original = { ...assignment, end };
  const response = ["accepted", "offered", "rescheduled"].find(event => {
    if (event === "accepted" && evidence.user_id !== "owner") return false;
    const expected = assignmentNotifications(original, event, [evidence.user_id], { legacyTimezone: true })[0];
    return evidence.title === expected.title && evidence.body === expected.body;
  });
  if (!response) return null;
  const status = response === "accepted" ? "accepted" : "pending";
  return { assignment: { ...assignment, status, note: durationNote(status), conflictOverride: undefined, updatedAt: new Date(now).toISOString(),
    calendarChange: { kind: "duration_recovered", previousStart: assignment.start, previousEnd: end, previousStatus: status,
      cancelledAt: assignment.updatedAt, changedAt: new Date(now).toISOString(), evidenceId: evidence.id } },
    correctedAlerts: cancellations.map(row => ({ id: row.id, userId: row.user_id })) };
}
