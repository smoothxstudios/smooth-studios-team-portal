/** A team member's own booking is self-served. Never treat the renter as paid staff. */
export function appointmentCancelled(item, assignments = [], now = Date.now()) {
  if (item.cancelled === true) return true;
  if (item.teamRenterId || item.ownerAccepted || Date.parse(item.end) > now) return false;
  const accepted = item.acceptedEmployeeIds ?? item.assignedEmployeeIds;
  if (!Array.isArray(accepted)) return false; // Compatibility with older display-only objects.
  return !accepted.length && !assignments.some(a => a.appointmentId === item.id && a.status === 'accepted' &&
    Date.parse(a.start) === Date.parse(item.start) && Date.parse(a.end) === Date.parse(item.end));
}

export function withAppointmentLifecycle(item, assignments = [], now = Date.now()) {
  const cancelled = appointmentCancelled(item, assignments, now);
  return { ...item, cancelled, ...(cancelled ? { cancellationReason: 'No team member accepted before the appointment ended.' } : {}) };
}
