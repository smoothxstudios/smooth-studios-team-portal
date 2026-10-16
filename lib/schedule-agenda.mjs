import { TEAM, addLocalDays, blockOccurrences, localInstant, overlaps } from "./team-schedule.mjs";

const active = item => ["pending", "accepted"].includes(item.status);
const unique = values => [...new Set(values)];
const normalize = value => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const name = id => TEAM.find(person => person.id === id)?.name ?? id;

export function agendaWeek(day) {
  const weekday = new Date(`${day}T12:00Z`).getUTCDay();
  const monday = addLocalDays(`${day}T00:00`, -((weekday + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => addLocalDays(monday, index).slice(0, 10));
}

/** Calendar bookings and their portal offers share one agenda entry. */
export function buildScheduleAgenda(schedule, { from, to, employeeId = "all", query = "" }) {
  const assignments = schedule.assignments ?? [];
  const byAppointment = new Map();
  for (const item of assignments) {
    if (!item.appointmentId) continue;
    if (!byAppointment.has(item.appointmentId)) byAppointment.set(item.appointmentId, []);
    byAppointment.get(item.appointmentId).push(item);
  }
  const appointmentIds = new Set((schedule.appointments ?? []).map(item => item.id));
  const entries = [];
  function work(appointment, offers) {
    const live = offers.filter(active);
    const source = appointment ?? live[0];
    if (!source || !overlaps(source, { start: from, end: to })) return;
    const calendarIds = unique(appointment?.acceptedEmployeeIds ?? []);
    const appAcceptedIds = unique(live.filter(a => a.status === "accepted").map(a => a.employeeId));
    const confirmedIds = unique([...calendarIds, ...appAcceptedIds]);
    // A Google RSVP is independent of the app response. Keep a pending app
    // offer findable even when that employee has already accepted in Calendar.
    const pendingIds = unique(live.filter(a => a.status === "pending").map(a => a.employeeId)).filter(id => !appAcceptedIds.includes(id));
    const employeeIds = unique([...confirmedIds, ...pendingIds]);
    const confirmations = employeeIds.map(employeeId => ({
      employeeId,
      appStatus: appAcceptedIds.includes(employeeId) ? "accepted" : pendingIds.includes(employeeId) ? "pending" : null,
      calendarAccepted: calendarIds.includes(employeeId),
    }));
    entries.push({
      id: `${appointment ? "booking" : "assignment"}:${source.id}`, kind: "work",
      start: source.start, end: source.end, title: source.title, customer: appointment?.customer ?? "",
      appointment: appointment ?? null, assignments: offers,
      calendarIds, confirmedIds, pendingIds, employeeIds, confirmations,
      status: confirmedIds.length ? "confirmed" : pendingIds.length ? "pending" : "unassigned",
    });
  }
  for (const appointment of schedule.appointments ?? []) work(appointment, byAppointment.get(appointment.id) ?? []);
  // Keep standalone tasks and active offers whose Calendar record is unavailable visible.
  for (const item of assignments.filter(active)) {
    if (!item.appointmentId || !appointmentIds.has(item.appointmentId)) work(null, [item]);
  }
  for (const [kind, records] of [["block", schedule.blocks ?? []], ["preference", schedule.workPreferences ?? []]]) {
    for (const record of records) for (const occurrence of blockOccurrences(record, from, to)) {
      entries.push({ ...occurrence, id: `${kind}:${record.id}:${occurrence.start}`, kind,
        title: kind === "block" ? record.reason : "Wants to work", employeeIds: [record.userId] });
    }
  }
  const words = normalize(query).split(" ").filter(Boolean);
  return entries.filter(item => {
    if (employeeId !== "all" && !item.employeeIds.includes(employeeId)) return false;
    const searchable = normalize([item.title, item.customer, item.reason, item.note,
      ...item.employeeIds.map(name), item.kind === "block" ? "blocked unavailable class" : item.kind === "preference" ? "preferred available" : ""].join(" "));
    return words.every(word => searchable.includes(word));
  }).sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id));
}

export function agendaMatchesStatus(item, status, employeeId = "all") {
  if (item.kind !== "work") return false;
  if (status === "all") return true;
  if (status === "unassigned") return item.status === "unassigned";
  const people = status === "pending" ? item.pendingIds : status === "confirmed" ? item.confirmedIds : [];
  return employeeId === "all" ? people.length > 0 : people.includes(employeeId);
}

export function agendaOnDay(items, day) {
  const start = localInstant(`${day}T00:00`), end = localInstant(addLocalDays(`${day}T00:00`, 1));
  return items.filter(item => overlaps(item, { start, end }));
}
