import { assignmentConflicts, hasConflictOverride, overlaps } from './team-schedule.mjs';

const active = item => ['pending', 'accepted'].includes(item.status);
const sameTime = (a, b) => Date.parse(a.start) === Date.parse(b.start) && Date.parse(a.end) === Date.parse(b.end);

/** Approval belongs to the recorded overlap, so either existing offer may respond. */
export function approvedAssignmentOverlap(target, source) {
  if (!target.id || source.id === target.id || target.employeeId !== source.employeeId ||
      !active(source) || !hasConflictOverride(source) || !overlaps(target, source)) return false;
  const approval = source.conflictOverride;
  if (Date.parse(target.calendarChange?.changedAt) > Date.parse(approval.approvedAt)) return false;
  if (Array.isArray(approval.relatedAssignments)) {
    return approval.relatedAssignments.some(peer => peer.id === target.id && sameTime(peer, target));
  }
  // Old approvals did not save the other offer's ID. An unchanged offer that
  // already existed at approval time is safe to recognize. Preserve that proof
  // on response, since saving a response changes updatedAt but not the overlap.
  if (target.overlapApprovals?.some(ref => ref.sourceId === source.id && ref.approvedAt === approval.approvedAt &&
      sameTime(ref, target) && sameTime({ start: ref.sourceStart, end: ref.sourceEnd }, source))) return true;
  const approvedAt = Date.parse(approval.approvedAt), createdAt = Date.parse(target.createdAt), updatedAt = Date.parse(target.updatedAt);
  return Number.isFinite(approvedAt) && Number.isFinite(createdAt) && Number.isFinite(updatedAt) &&
    createdAt <= approvedAt && updatedAt >= createdAt && updatedAt <= approvedAt;
}

export function unapprovedAssignmentConflicts(employeeId, period, blocks, assignments, appointments, excludeId = '') {
  if (hasConflictOverride(period)) return [];
  const approved = assignments.filter(item => approvedAssignmentOverlap(period, item));
  const ids = new Set(approved.map(item => item.id));
  // A Calendar RSVP for the same approved assignment is the same commitment.
  const remainingAppointments = appointments.filter(item => !approved.some(peer => peer.appointmentId === item.id && sameTime(peer, item)));
  return assignmentConflicts(employeeId, period, blocks, assignments.filter(item => !ids.has(item.id)), remainingAppointments, excludeId);
}

export function captureOverlapApprovals(item, assignments) {
  return assignments.filter(source => approvedAssignmentOverlap(item, source)).map(source => ({
    sourceId: source.id, sourceStart: source.start, sourceEnd: source.end,
    start: item.start, end: item.end, approvedAt: source.conflictOverride.approvedAt,
  }));
}

export function createConflictOverride(item, assignments, now = Date.now()) {
  return { approvedBy: 'owner', approvedAt: new Date(now).toISOString(), start: item.start, end: item.end,
    relatedAssignments: assignments.filter(peer => peer.id !== item.id && peer.employeeId === item.employeeId && active(peer) && overlaps(item, peer))
      .map(peer => ({ id: peer.id, start: peer.start, end: peer.end })),
  };
}
