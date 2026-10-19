import { TEAM } from "../lib/team-schedule.mjs";
import { notificationTime, notificationText } from "./notification-content.mjs";
import { rentalAlertTargetId } from "../lib/alert-target.mjs";
import { rentalStaffRemovals, withoutRemovedRentalStaff } from "../lib/rental-staff.mjs";
import { flushAlerts } from "./push.mjs";

const leadMs = 10 * 60_000;
const freshnessMs = 12 * 60_000;
const isRental = item => /studio.*rental|rental.*studio/i.test(item.title);
const knownPerson = id => TEAM.some(person => person.id === id);
const sameTime = (a, b) => Date.parse(a.start) === Date.parse(b.start) && Date.parse(a.end) === Date.parse(b.end);
const dollars = cents => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

// Never infer a balance from missing payment data, or notify a tentative/pending employee.
export function rentalBalanceCandidates(appointments, assignments, syncedAt, now = Date.now()) {
  const lastSync = Date.parse(syncedAt);
  if (!Number.isFinite(lastSync) || now - lastSync > freshnessMs || lastSync > now + 60_000) return [];
  const result = [];
  for (const original of appointments) {
    const start = Date.parse(original.start), end = Date.parse(original.end);
    if (!isRental(original) || !(start < now && now >= end - leadMs && now < end) ||
        original.fullyPaid !== false || !Number.isSafeInteger(original.priceCents) || original.priceCents <= 0 ||
        !Number.isSafeInteger(original.paidOnlineCents) || original.paidOnlineCents < 0 ||
        original.paidOnlineCents >= original.priceCents) continue;
    const linked = assignments.filter(item => item.appointmentId === original.id && sameTime(item, original));
    const removed = new Set(rentalStaffRemovals(original, linked, syncedAt).map(item => item.employeeId));
    const appointment = withoutRemovedRentalStaff(original, linked, syncedAt);
    const recipients = new Set(appointment.acceptedEmployeeIds);
    for (const item of linked) if (item.status === "accepted" && !item.removeCalendarGuest) recipients.add(item.employeeId);
    const remaining = original.priceCents - original.paidOnlineCents;
    for (const employeeId of recipients) {
      if (!knownPerson(employeeId) || removed.has(employeeId)) continue;
      result.push({ id: original.id, end: original.end, employeeId,
        payload: { title: "Rental balance reminder",
          body: notificationText(`${dollars(remaining)} remains due for ${original.title} · ${notificationTime(original.start, original.end)}. Please verify payment before the client leaves.`, 360),
          target: "scheduling", targetId: rentalAlertTargetId(original.id), personId: employeeId } });
    }
  }
  return result;
}

const receiptId = async (appointmentId, end, userId) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([appointmentId, end, userId])));
  return "rbal_" + Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("");
};

// Check recent synced payments and current staff; a receipt cannot be inserted twice.
// The SQLite insertion trigger creates the encrypted push queue and the saved Alerts entry.
export async function sendRentalBalanceReminders(env, send = fetch, now = Date.now()) {
  const db = env.DB;
  const state = await db.prepare("SELECT revision, generation, synced_at FROM team_state WHERE id = 1").first();
  if (!state?.synced_at) return { queued: 0 };
  const [rows, people] = await Promise.all([
    db.prepare("SELECT data FROM team_appointments WHERE generation = ?").bind(state.generation).all(),
    db.prepare("SELECT data FROM team_assignments").all(),
  ]);
  const appointments = rows.results.map(row => JSON.parse(row.data));
  const assignments = people.results.map(row => JSON.parse(row.data));
  const candidates = rentalBalanceCandidates(appointments, assignments, state.synced_at, now);
  let queued = 0;
  for (const item of candidates) {
    const booking = appointments.find(a => a.id === item.id);
    if (!booking || !item.payload.targetId) continue;
    const id = await receiptId(item.id, item.end, item.employeeId);
    const saved = await db.prepare(`INSERT OR IGNORE INTO rental_balance_reminders
      (id,appointment_id,end_time,user_id,payload,due_at,ends_at)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS (
        SELECT 1 FROM team_state s JOIN team_appointments a
          ON a.generation = s.generation AND a.id = ?
        WHERE s.revision = ? AND s.generation = ? AND s.synced_at = ? AND a.data = ?
      )`).bind(id, item.id, item.end, item.employeeId, JSON.stringify(item.payload),
        now, Date.parse(item.end), item.id, state.revision, state.generation, state.synced_at,
        JSON.stringify(booking)).run();
    queued += Number(saved.meta.changes || 0);
  }
  if (queued) await flushAlerts(env, send);
  return { queued };
}
