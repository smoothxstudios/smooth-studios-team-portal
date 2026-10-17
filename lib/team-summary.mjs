import { studioLocal, localInstant, addLocalDays } from './team-schedule.mjs';
import { customerFullyPaid } from './owner-finances.mjs';
import { creativePaid, creativeOwed } from './creative-work.mjs';

/** Earned pay across the available history. Advance credits settle earnings without becoming new earnings.
 * @param {import('./dashboard-types').Employee[]} employees
 * @param {import('./dashboard-types').Rental[]} rentals
 * @param {import('./use-creative-work').CreativeAssignment[]} creative
 */
export function teamEarnings(employees, rentals, creative = [], now = Date.now()) {
  return employees.map(person => {
    let earned = 0, owed = 0, settled = 0, projected = 0, missingRates = 0;
    for (const rental of rentals) {
      if (!rental.assignedEmployeeIds.includes(person.id)) continue;
      const pay = rental.employeePayouts[person.id];
      if (!pay) continue;
      if (pay.compensationConfigured === false) { missingRates++; continue; }
      if (Date.parse(rental.end) > now) { projected += pay.amountCents; continue; }
      if (!customerFullyPaid(rental)) continue;
      const remaining = Math.max(0, Math.min(pay.amountCents, pay.outstandingCents ?? (pay.amountCents - (pay.paidAmountCents ?? (pay.paid ? pay.amountCents : 0)))));
      earned += pay.amountCents; owed += remaining; settled += pay.amountCents - remaining;
    }
    for (const item of creative.filter(item => item.employeeId === person.id)) {
      if (item.status === 'approved') { earned += item.amountCents; owed += creativeOwed(item); settled += creativePaid(item); }
      else if (['offered', 'accepted', 'submitted', 'revision'].includes(item.status)) projected += item.amountCents;
    }
    return { ...person, earned, owed, settled, projected, missingRates };
  });
}

/** Completed accepted schedule durations, not clock-in records. Merge overlaps and duplicate invitations.
 * @param {import('./dashboard-types').Employee[]} employees
 * @param {import('./dashboard-types').Rental[]} rentals
 * @param {import('./team-api').TeamSchedule | null} schedule
 */
export function weeklyTeamHours(employees, rentals, schedule = null, now = Date.now()) {
  const today = studioLocal(now).slice(0, 10);
  const weekday = new Date(`${today}T12:00Z`).getUTCDay();
  const monday = addLocalDays(`${today}T00:00`, -((weekday + 6) % 7));
  const from = Date.parse(localInstant(monday)), to = Date.parse(localInstant(addLocalDays(monday, 7)));
  const appointments = schedule ? schedule.appointments : rentals.map(r => ({ ...r, acceptedEmployeeIds: r.assignedEmployeeIds }));
  const people = employees.map(person => {
    const intervals = [];
    const add = item => {
      const start = Date.parse(item.start), end = Date.parse(item.end);
      if (Number.isFinite(start) && Number.isFinite(end) && end <= now && end > from && start < to && end > start) intervals.push([Math.max(start, from), Math.min(end, to)]);
    };
    for (const item of appointments) if (item.acceptedEmployeeIds.includes(person.id)) add(item);
    for (const item of schedule?.assignments ?? []) {
      if (item.employeeId !== person.id || item.status !== 'accepted') continue;
      if (item.appointmentId && !appointments.some(a => a.id === item.appointmentId && Date.parse(a.start) === Date.parse(item.start) && Date.parse(a.end) === Date.parse(item.end))) continue;
      add(item);
    }
    intervals.sort((a, b) => a[0] - b[0]);
    let total = 0, previousEnd = from;
    for (const [start, end] of intervals) { total += Math.max(0, end - Math.max(start, previousEnd)); previousEnd = Math.max(previousEnd, end); }
    return { ...person, hours: total / 3600000 };
  });
  return { from: new Date(from).toISOString(), through: addLocalDays(monday, 6).slice(0, 10), people };
}
