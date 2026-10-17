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
  return person.appStatus === "accepted" ? "Accepted in app" : person.appStatus === "pending" ? "Awaiting app response"
    : calendarInvitationLabel(person.calendarAccepted ? "accepted" : person.calendarStatus);
}
