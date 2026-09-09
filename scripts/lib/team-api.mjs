import { randomUUID } from "node:crypto";
import { teamToken } from "../../lib/team-auth.mjs";
import { TEAM_API_URL } from "../../lib/team-schedule.mjs";

export async function syncTeamSchedule(rentals, ownerPassword) {
  const token = await teamToken(ownerPassword, "sync");
  async function request(path, data) {
    const response = await fetch(`${TEAM_API_URL}${path}`, {
      method: data ? "POST" : "GET", redirect: "error",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Team schedule sync failed (${response.status}). Existing encrypted dashboards were not overwritten.`);
    return response.json();
  }
  const generation = randomUUID();
  // Deliberate allowlist: no payments, contact information, Stripe identifiers,
  // credentials, or private Calendar descriptions are copied to scheduling.
  const appointments = rentals.map(r => ({ id: r.id, title: r.title, customer: r.customer ?? "",
    start: r.start, end: r.end, priceCents: r.priceCents, acceptedEmployeeIds: r.assignedEmployeeIds }));
  for (let offset = 0; offset < appointments.length; offset += 50) {
    await request("/sync/import", { generation, appointments: appointments.slice(offset, offset + 50) });
  }
  await request("/sync/commit", { generation, count: appointments.length });
  const result = await request("/sync/accepted");
  if (!Array.isArray(result.assignments) || !Array.isArray(result.calendarAssignments)) throw new Error("Deploy the updated team API before syncing Calendar assignment notes. Dashboards were not overwritten.");
  const push = result.pushDiagnostics;
  if (push && [push.registeredDevices, push.queuedAlerts, push.retryingAlerts].every(Number.isSafeInteger)) {
    process.stdout.write(`Push setup: ${push.registeredDevices} registered device(s); ${push.queuedAlerts} alerts queued; ${push.retryingAlerts} alerts retrying.\n`);
  }
  return { assignments: result.assignments, calendarAssignments: result.calendarAssignments };
}
