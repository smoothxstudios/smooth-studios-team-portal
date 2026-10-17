const active = item => ["pending", "accepted"].includes(item.status);
const sameTime = (a, b) => Date.parse(a.start) === Date.parse(b.start) && Date.parse(a.end) === Date.parse(b.end);

// An explicit owner removal is separate from cancelling an app offer. Keep the
// history, but stop showing the person as current staff while Google catches up.
export function rentalStaffRemovals(appointment, assignments, syncedAt) {
  const offers = assignments.filter(item => item.appointmentId === appointment.id && sameTime(item, appointment));
  return offers.filter(item => item.removeCalendarGuest === true && item.status === "cancelled" &&
    !offers.some(other => other.employeeId === item.employeeId && (active(other) ||
      Date.parse(other.createdAt) > Date.parse(item.createdAt))) &&
    // A new Calendar import after verified removal can contain a fresh invite.
    !(item.calendarSync?.status === "synced" && item.calendarSync.code === "person_removed" &&
      Date.parse(syncedAt) > item.calendarSync.checkedAt &&
      (appointment.acceptedEmployeeIds?.includes(item.employeeId) ||
        appointment.calendarInvitations?.some(guest => guest.employeeId === item.employeeId))));
}

export function withoutRemovedRentalStaff(appointment, assignments, syncedAt) {
  const removed = new Set(rentalStaffRemovals(appointment, assignments, syncedAt).map(item => item.employeeId));
  if (!removed.size) return appointment;
  return { ...appointment, acceptedEmployeeIds: (appointment.acceptedEmployeeIds ?? []).filter(id => !removed.has(id)),
    calendarInvitations: (appointment.calendarInvitations ?? []).filter(guest => !removed.has(guest.employeeId)) };
}
