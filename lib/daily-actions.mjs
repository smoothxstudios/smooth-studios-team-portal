import { buildScheduleAgenda } from "./schedule-agenda.mjs";
import { studioLocal, localInstant } from "./team-schedule.mjs";

export function ownerDailyWork(schedule, now = Date.now()) {
  const today = studioLocal(now).slice(0, 10);
  const latestEnd = Math.max(now + 1, ...[...(schedule.appointments ?? []), ...(schedule.assignments ?? [])].map(item => Date.parse(item.end)).filter(Number.isFinite));
  const entries = buildScheduleAgenda({ ...schedule, blocks: [], workPreferences: [] }, { from: localInstant(`${today}T00:00`), to: new Date(latestEnd).toISOString() }).filter(item => item.kind === "work");
  return {
    today: entries.filter(item => studioLocal(item.start).slice(0, 10) === today || (Date.parse(item.start) < now && Date.parse(item.end) > now)),
    pending: entries.filter(item => Date.parse(item.end) > now && item.pendingIds.length > 0),
    unassigned: entries.filter(item => Date.parse(item.end) > now && item.status === "unassigned"),
  };
}

export function creativeNextActions(items, isOwner) {
  const statuses = isOwner ? ["submitted", "offered"] : ["offered", "revision", "accepted"];
  return items.filter(item => !item.entryType && statuses.includes(item.status)).sort((a, b) =>
    statuses.indexOf(a.status) - statuses.indexOf(b.status) || Date.parse(a.dueAt) - Date.parse(b.dueAt));
}

export function appointmentBalance(appointment) {
  if (appointment.fullyPaid) return { label: "Paid in full", remaining: 0 };
  if (!Number.isFinite(appointment.paidOnlineCents) || (appointment.fullyPaid === false && appointment.paidOnlineCents >= appointment.priceCents)) return { label: "Payment needs review", remaining: null };
  return { label: "Balance remaining", remaining: Math.max(0, appointment.priceCents - appointment.paidOnlineCents) };
}
