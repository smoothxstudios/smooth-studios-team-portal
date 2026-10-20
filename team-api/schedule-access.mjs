import { withoutRemovedRentalStaff } from "../lib/rental-staff.mjs";

// Shared by the authenticated schedule and read-only personal calendar feeds.
export async function calendarAssignments(db, s, user) {
  const rows = (await db.prepare(`SELECT q.assignment_id, q.status, q.result, q.updated_at FROM calendar_assignment_outbox q
    JOIN team_assignments a ON a.id = q.assignment_id WHERE ? = 'owner' OR a.employee_id = ?`).bind(user, user).all()).results;
  return s.assignments.filter(a => user === "owner" || a.employeeId === user).map(assignment => {
    const row = rows.find(item => item.assignment_id === assignment.id);
    if (!row) return assignment;
    let result = {}; try { result = JSON.parse(row.result ?? "{}"); } catch { /* Preserve pending status. */ }
    let deliveryStatus = row.status;
    if (row.status === "synced" && Date.parse(s.state.synced_at) > row.updated_at && !["invitation_removed", "person_removed", "no_calendar_invitation"].includes(result.code)) {
      const invitation = s.appointments.find(appointment => appointment.id === assignment.appointmentId)?.calendarInvitations?.find(item => item.employeeId === assignment.employeeId);
      result.googleStatus = invitation?.status;
      if (!invitation && assignment.status !== "cancelled") { deliveryStatus = "needs_review"; result.code = "invitation_missing"; }
    }
    return { ...assignment, calendarSync: { status: deliveryStatus, checkedAt: row.updated_at,
      ...(typeof result.code === "string" ? { code: result.code } : {}),
      ...(["accepted", "declined", "needsAction", "tentative", "removed"].includes(result.googleStatus) ? { googleStatus: result.googleStatus } : {}) } };
  });
}

export function visibleAppointments(s, assignments, user) {
  const ids = new Set(assignments.filter(a => ["pending", "accepted"].includes(a.status)).map(a => a.appointmentId));
  return s.appointments.map(a => withoutRemovedRentalStaff(a, assignments, s.state.synced_at))
    .filter(a => user === "owner" || ids.has(a.id) || a.acceptedEmployeeIds.includes(user) ||
      a.calendarInvitations?.some(invitation => invitation.employeeId === user && invitation.status !== "declined"))
    .map(a => user === "owner" ? a : { ...a, fullyPaid: undefined, paidOnlineCents: undefined,
      acceptedEmployeeIds: a.acceptedEmployeeIds.filter(id => id === user),
      calendarInvitations: (a.calendarInvitations ?? []).filter(invitation => invitation.employeeId === user) });
}
