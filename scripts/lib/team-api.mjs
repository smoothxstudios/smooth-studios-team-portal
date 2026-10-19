import { teamToken } from "../../lib/team-auth.mjs";
import { TEAM_API_URL } from "../../lib/team-schedule.mjs";
import { calendarRecord, calendarKey } from "../../lib/sync-records.mjs";
import { syncRecords } from "./incremental-sync.mjs";

export async function syncTeamSchedule(rentals, ownerPassword, calendarConfiguration, calendarReadAt) {
  const token = await teamToken(ownerPassword, "sync");
  async function request(path, data) {
    const response = await fetch(`${TEAM_API_URL}${path}`, {
      method: data ? "POST" : "GET", redirect: "error",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw Object.assign(new Error(`Team schedule sync failed (${response.status}). Existing encrypted dashboards were not overwritten.`), { status: response.status });
    return response.json();
  }
  if (calendarConfiguration) await request("/sync/calendar/configuration", calendarConfiguration);
  // Deliberate allowlist: filtered rental descriptions include client contact,
  // quoted price, paid-online amount and setup answers for the assigned team.
  // Stripe identifiers, credentials, admin links and raw descriptions stay out.
  const appointments = rentals.map(r => calendarRecord({ id: r.id, title: r.title, customer: r.customer ?? "",
    start: r.start, end: r.end, priceCents: r.priceCents, fullyPaid: r.fullyPaid,
    paidOnlineCents: r.paidOnlineCents, rentalDetails: r.rentalDetails ?? "", acceptedEmployeeIds: r.assignedEmployeeIds,
    calendarInvitations: r.calendarInvitations ?? [] }));
  const synced = await syncRecords({ request, prefix: '/sync', records: appointments, key: calendarKey, field: 'appointments',
    time: { calendarReadAt: calendarReadAt ?? new Date().toISOString() } });
  process.stdout.write(`Calendar database sync: ${JSON.stringify(synced.syncStats)}\n`);
  const result = await request("/sync/accepted");
  if (!Array.isArray(result.assignments) || !Array.isArray(result.calendarAssignments)) throw new Error("Deploy the updated team API before syncing Calendar assignment notes. Dashboards were not overwritten.");
  const push = result.pushDiagnostics;
  if (Number.isSafeInteger(result.durationRecovery?.restored) && Number.isSafeInteger(result.durationRecovery?.needsReview)) {
    process.stdout.write(`Rental duration recovery: ${result.durationRecovery.restored} restored; ${result.durationRecovery.needsReview} require manual review.\n`);
  }
  if (push && [push.registeredDevices, push.queuedAlerts, push.retryingAlerts].every(Number.isSafeInteger)) {
    process.stdout.write(`Push setup: ${push.registeredDevices} registered device(s); ${push.queuedAlerts} alerts queued; ${push.retryingAlerts} alerts retrying.\n`);
  }
  return { assignments: result.assignments, calendarAssignments: result.calendarAssignments };
}
