export const CALENDAR_INVITATION_STATUSES = ["accepted", "tentative", "needsAction", "declined"];

/** Google guest responses are independent of dashboard assignment responses. */
export function calendarInvitationStatus(appointment, employeeId) {
  if (appointment.acceptedEmployeeIds?.includes(employeeId)) return "accepted";
  return appointment.calendarInvitations?.find(invitation => invitation.employeeId === employeeId)?.status ?? null;
}

/** @returns {import('./team-api').CalendarInvitation[]} */
export function pendingCalendarInvitations(appointment) {
  return (appointment.calendarInvitations ?? []).filter(invitation =>
    ["needsAction", "tentative"].includes(invitation.status) && !appointment.acceptedEmployeeIds?.includes(invitation.employeeId));
}

export function calendarInvitationLabel(status) {
  return status === "accepted" ? "Calendar accepted" : status === "tentative" ? "Tentative in Google Calendar"
    : status === "declined" ? "Declined in Google Calendar" : "Invited in Google Calendar";
}

export function assignmentResponseLabel(person) {
  return person.appStatus === "accepted" ? (person.ownerConfirmed ? "Confirmed by Smooth" : "Accepted in app") : person.appStatus === "pending" ? "Awaiting app response"
    : calendarInvitationLabel(person.calendarAccepted ? "accepted" : person.calendarStatus);
}

/** The signed-in person's live app offer takes precedence over the Google copy. */
export function appointmentResponsePrompt(appointment, assignments, employeeId) {
  const offers = assignments.filter(item => item.appointmentId === appointment.id && item.employeeId === employeeId);
  if (offers.some(item => item.status === "pending")) return "Open appointment to accept or decline in the app";
  if (offers.some(item => item.status === "accepted")) return "Accepted in app";
  const status = calendarInvitationStatus(appointment, employeeId);
  if (status === "accepted") return "Calendar accepted";
  if (["needsAction", "tentative"].includes(status)) return "Google Calendar invitation · respond in Google Calendar";
  return "No active offer";
}
