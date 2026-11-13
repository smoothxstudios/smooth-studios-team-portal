import { addLocalDays, blockOccurrences, localInstant, overlaps } from './team-schedule.mjs';

// Preferences rank willing staff; only blocks and commitments remove free time.
export function dayAvailability(personId, day, schedule) {
  const start = localInstant(`${day}T00:00`);
  const end = localInstant(addLocalDays(`${day}T00:00`, 1));
  const period = { start, end };
  const blocks = schedule.blocks.filter(x => x.userId === personId).flatMap(x => blockOccurrences(x, start, end));
  const assignments = schedule.assignments.filter(x => x.employeeId === personId && ['pending', 'accepted'].includes(x.status) && overlaps(x, period));
  const appointments = schedule.appointments.filter(x => overlaps(x, period) && (x.acceptedEmployeeIds.includes(personId) || x.calendarInvitations?.some(i => i.employeeId === personId && ['tentative', 'needsAction'].includes(i.status))) && !assignments.some(a => a.appointmentId === x.id));
  const commitments = [...blocks.map(x => ({ ...x, label: x.reason || 'Blocked time' })), ...assignments.map(x => ({ ...x, label: x.status === 'pending' ? 'Pending offer' : 'Assigned work' })), ...appointments.map(x => ({ ...x, label: x.acceptedEmployeeIds.includes(personId) ? 'Scheduled work' : 'Calendar invitation' }))].sort((a,b) => Date.parse(a.start) - Date.parse(b.start));
  const windows = commitments.map(x => [Math.max(Date.parse(start), Date.parse(x.start)), Math.min(Date.parse(end), Date.parse(x.end))]);
  const free = [];
  let cursor = Date.parse(start);
  for (const [from, to] of windows) {
    if (from > cursor) free.push({ start: new Date(cursor).toISOString(), end: new Date(from).toISOString() });
    cursor = Math.max(cursor, to);
  }
  if (cursor < Date.parse(end)) free.push({ start: new Date(cursor).toISOString(), end });
  const preferred = (schedule.workPreferences ?? []).filter(x => x.userId === personId).flatMap(x => blockOccurrences(x, start, end));
  return { start, end, free, commitments, preferred, status: !commitments.length ? 'available' : free.length ? 'partial' : 'unavailable' };
}
