import { TEAM } from './team-schedule.mjs';
import { notificationText, notificationTime } from '../team-api/notification-content.mjs';

export const NOTIFICATION_PRESETS = [
  { id: 'rental-response', label: 'Rental response', detail: 'Accept or decline an offer' },
  { id: 'upcoming-rental', label: 'Upcoming rental', detail: 'Remind the confirmed crew' },
  { id: 'availability', label: 'Update availability', detail: 'Preferred days and blocked time' },
  { id: 'calendar', label: 'Connect Calendar', detail: 'Link their Google account' },
  { id: 'refresh', label: 'Refresh schedule', detail: 'Check the latest assignments' },
  { id: 'custom', label: 'Custom message', detail: 'Write your own notification' },
];
const employees = new Set(TEAM.filter(person => person.id !== 'owner').map(person => person.id));
const rentalTitle = title => /\bstudio(?:\s+[a-z])?\s+rentals?\b/i.test(title ?? '');
const sameTime = (a, b) => Date.parse(a.start) === Date.parse(b.start) && Date.parse(a.end) === Date.parse(b.end);

/** Use actual future rentals and recorded confirmations; never infer crew from an invitation.
 * @param {import('./team-api').TeamSchedule | null} schedule
 */
export function notificationRentalChoices(schedule, now = Date.now()) {
  const assignments = schedule?.assignments ?? [];
  const bookings = (schedule?.appointments ?? []).filter(booking => rentalTitle(booking.title) &&
    Number.isFinite(Date.parse(booking.start)) && Date.parse(booking.start) > now &&
    Number.isFinite(Date.parse(booking.end)) && Date.parse(booking.end) > Date.parse(booking.start))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).map(booking => ({
      id: booking.id, title: booking.title, start: booking.start, end: booking.end,
      recipientIds: [...new Set([...(booking.acceptedEmployeeIds ?? []), ...assignments.filter(assignment =>
        assignment.appointmentId === booking.id && assignment.status === 'accepted' && sameTime(assignment, booking)).map(assignment => assignment.employeeId)])]
        .filter(id => employees.has(id)).sort(),
    }));
  const responses = assignments.filter(assignment => assignment.status === 'pending' && employees.has(assignment.employeeId) &&
    bookings.some(booking => booking.id === assignment.appointmentId && sameTime(assignment, booking)))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).map(assignment => ({
      id: assignment.id, appointmentId: assignment.appointmentId, employeeId: assignment.employeeId,
      title: 'Assignment response reminder', start: assignment.start, end: assignment.end,
      bookingTitle: bookings.find(booking => booking.id === assignment.appointmentId).title,
      recipientIds: [assignment.employeeId],
      body: notificationText(`${notificationText(assignment.title, 120)} · ${notificationTime(assignment.start, assignment.end)}. Please accept or decline this offer in your dashboard.`, 360),
    }));
  return { bookings, responses };
}

/** Titles and copy stay tied to the selected task or booking.
 * @param {string | null} preset
 * @param {{title: string, body?: string, start: string, end: string} | null} rental
 */
export function notificationPresetMessage(preset, rental = null) {
  if (preset === 'rental-response') return rental ? { title: rental.title, body: rental.body ?? '', target: 'scheduling' } : null;
  if (preset === 'upcoming-rental') return rental ? { title: 'Upcoming studio rental',
    body: `${notificationText(rental.title, 120)} · ${notificationTime(rental.start, rental.end)}. Please review this rental’s details in Schedule.`, target: 'scheduling' } : null;
  if (preset === 'availability') return { title: 'Update your availability',
    body: 'Please update the days you want to work and any unavailable time in Availability so I can plan studio coverage.', target: 'availability' };
  if (preset === 'calendar') return { title: 'Connect Google Calendar',
    body: 'Please open Settings → Preferences → Google Calendar, tap Connect Google, and use the Google account that receives your studio invitations so app responses can update your Calendar RSVP.', target: 'settings' };
  if (preset === 'refresh') return { title: 'Check the latest schedule',
    body: 'Please open Schedule, then pull down from the top to refresh and review your latest bookings and assignments.', target: 'scheduling' };
  return null;
}

/** A refreshed list must not silently change the rental or crew the owner reviewed. */
const rentalSignature = item => JSON.stringify({ id: item.id, appointmentId: item.appointmentId, employeeId: item.employeeId,
  title: item.title, bookingTitle: item.bookingTitle, body: item.body, start: Date.parse(item.start), end: Date.parse(item.end), recipientIds: [...item.recipientIds].sort() });
export function sameRentalReminder(a, b) { return Boolean(a && b && rentalSignature(a) === rentalSignature(b)); }

/** Retrying an uncertain offer reminder keeps its UUID bound to that exact offer. */
export function createRentalReminderIntent(createId = () => crypto.randomUUID()) {
  let previous = null;
  return {
    /** @param {string} assignmentId @param {object} [detail] */
    prepare(assignmentId, detail) {
      if (!assignmentId) throw new Error('Choose a rental offer.');
      const version = detail ? rentalSignature(detail) : '';
      if (previous?.assignmentId !== assignmentId || previous.version !== version) previous = { assignmentId, version, id: createId() };
      return { assignmentId, id: previous.id };
    },
    clear() { previous = null; },
  };
}
