import { reconcileAdvances } from './payroll.mjs';

// Completion and its earning are committed together under the schedule revision.
// The assignment ID is also the earning ID, making retries unable to duplicate pay.
export async function completeStudioTask({ db, item, input, user, state, commit, saveAssignment, fail, env, ctx, flushAlerts }) {
  if (user !== 'owner') fail(403, 'Only Smooth can confirm completed tasks and add earnings.');
  if (item.workType !== 'studio-task' || !item.taskPay) fail(400, 'Choose a studio task shift.');
  if (item.completedAt) return { saved: true, notification: 'This shift’s earnings are already recorded.' };
  if (!['pending', 'accepted'].includes(item.status) || Date.parse(item.end) > Date.now() || input.confirmCompleted !== true) fail(409, 'After the shift ends, confirm that this person completed the tasks.');
  const now = new Date().toISOString();
  const earning = { id: item.id, employeeId: item.employeeId, entryType: 'manual', studioTaskId: item.id, workCategory: 'studio-tasks',
    title: item.title, instructions: item.instructions, earnedAt: item.end, dueAt: item.end, amountCents: item.taskPay.amountCents,
    references: [], status: 'approved', version: 1, createdAt: now, updatedAt: now, approvedAt: now, submissions: [], payments: [],
    history: [{ id: crypto.randomUUID(), event: 'studio tasks completed', by: user, at: now }] };
  const updated = { ...item, status: 'accepted', completedAt: now, updatedAt: now, payrollEntryId: earning.id,
    ownerConfirmation: { confirmedBy: 'owner', confirmedAt: now } };
  await commit(db, state, mutation => [saveAssignment(db, updated, mutation),
    db.prepare(`INSERT INTO team_creative_assignments (id, employee_id, version, mutation, data)
      SELECT ?, ?, 1, ?, ? WHERE EXISTS (SELECT 1 FROM team_state WHERE id = 1 AND mutation = ?)`)
      .bind(earning.id, earning.employeeId, mutation, JSON.stringify(earning), mutation)],
    [{ userId: item.employeeId, kind: 'creative', title: 'Studio tasks completed', body: 'Smooth confirmed your shift. Your earnings are ready to review.', target: 'payouts', targetId: earning.id, personId: item.employeeId }]);
  ctx.waitUntil(flushAlerts(env));
  await reconcileAdvances(db);
  return { saved: true, assignment: updated, notification: 'Shift completed and earnings added to Payouts. No payment was recorded.' };
}
