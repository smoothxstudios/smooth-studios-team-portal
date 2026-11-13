import { withinStudioHours } from './studio-hours.mjs';
import { TEAM, assignmentConflicts, workPreferenceMatch, overlaps } from './team-schedule.mjs';

export function rentalSuggestions(period, schedule) {
  if (!withinStudioHours(period) || !schedule || !Number.isFinite(Date.parse(period.start)) || !Number.isFinite(Date.parse(period.end)) || Date.parse(period.end) <= Date.parse(period.start)) return [];
  const appointmentId = period.appointmentId ?? period.id;
  return TEAM.filter(p => p.id !== 'owner' && !p.seasonal && (!schedule.activeEmployeeIds || schedule.activeEmployeeIds.includes(p.id)))
    .filter(p => !period.acceptedEmployeeIds?.includes(p.id)
      && !period.calendarInvitations?.some(i => i.employeeId === p.id && ['accepted', 'tentative', 'needsAction'].includes(i.status))
      && !schedule.assignments.some(a => appointmentId && a.appointmentId === appointmentId && a.employeeId === p.id && ['pending','accepted'].includes(a.status))
      && !schedule.appointments.some(a => a.id !== appointmentId && overlaps(a, period) && a.calendarInvitations?.some(i => i.employeeId === p.id && ['tentative','needsAction'].includes(i.status)))
      && !assignmentConflicts(p.id, { ...period, appointmentId }, schedule.blocks, schedule.assignments, schedule.appointments).length)
    .map(p => { const preference = workPreferenceMatch(p.id, period, schedule.workPreferences ?? []); return { ...p, preference,
      reason: preference === 'full' ? 'Available · preferred hours' : preference === 'partial' ? 'Available · partly within preferred hours' : 'Available — no blocked time or conflicts' }; })
    .sort((a,b) => ({full:0,partial:1,none:2}[a.preference] ?? 2) - ({full:0,partial:1,none:2}[b.preference] ?? 2) || a.name.localeCompare(b.name));
}
