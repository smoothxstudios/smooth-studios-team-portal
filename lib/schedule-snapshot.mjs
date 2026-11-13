/** A rental detail sheet has no draft; approvals and responses can refresh in place. */
export function scheduleHasOpenEditor(doc = document) {
  return Boolean(doc.querySelector('[role="dialog"]:not([data-schedule-live-view="true"]), [role="alertdialog"], [role="listbox"], [role="menu"], .schedule-confirm-inline, .appointment-calendar-options[open]') ||
    doc.activeElement?.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
}

/** Check again after the request: an editor or write may have started meanwhile. */
export async function readScheduleSnapshot({ read, canApply, onSnapshot }) {
  if (!canApply()) return false;
  const snapshot = await read();
  if (!canApply()) return false;
  onSnapshot(snapshot);
  return true;
}

/** Reflect only confirmed writes while waiting for the authoritative revision. */
export function applyConfirmedScheduleMutation(schedule, path, data, result) {
  if (!schedule) return schedule;
  if (path.startsWith('/assignments/') && ['accepted', 'declined', 'cancelled'].includes(data.status)) {
    return { ...schedule, assignments: schedule.assignments.map(assignment =>
      assignment.id === path.slice('/assignments/'.length) ? { ...assignment, status: data.status } : assignment) };
  }
  const removed = path === '/rental-staff/remove' && result.removedAssignment;
  if (!removed) return schedule;
  return { ...schedule,
    appointments: schedule.appointments.map(appointment => appointment.id === removed.appointmentId ? {
      ...appointment,
      acceptedEmployeeIds: appointment.acceptedEmployeeIds.filter(id => id !== removed.employeeId),
      calendarInvitations: appointment.calendarInvitations?.filter(person => person.employeeId !== removed.employeeId),
    } : appointment),
    assignments: [...schedule.assignments.filter(assignment => assignment.id !== removed.id).map(assignment =>
      assignment.appointmentId === removed.appointmentId && assignment.employeeId === removed.employeeId &&
      assignment.start === removed.start && assignment.end === removed.end && ['pending', 'accepted'].includes(assignment.status)
        ? { ...assignment, status: 'cancelled' } : assignment), removed],
  };
}
