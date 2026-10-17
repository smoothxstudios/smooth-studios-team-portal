// One predicate powers the badge and the private detail view. Reading a review
// never reallocates credit, changes pay, or dismisses a discrepancy.
export const advanceReviewQuery = `SELECT a.employee_id, p.source_kind, p.source_id,
  SUM(p.amount_cents) AS applied, MAX(p.cash_floor_cents) AS cash_floor, MIN(p.created_at) AS credited_at
  FROM payroll_advance_allocations p JOIN payroll_advances a ON a.id = p.advance_id
  LEFT JOIN payroll_sources s ON s.employee_id = a.employee_id AND s.kind = p.source_kind AND s.id = p.source_id
  WHERE (? IS NULL OR a.employee_id = ?) GROUP BY a.employee_id, p.source_kind, p.source_id
  HAVING s.id IS NULL OR SUM(p.amount_cents) > s.amount_cents
    OR (p.source_kind = 'rental' AND SUM(p.amount_cents) + MAX(p.cash_floor_cents) > s.amount_cents)`;

export async function advanceReviewDetails(db) {
  const rows = await db.prepare(`WITH flagged AS (${advanceReviewQuery})
    SELECT f.*, r.amount_cents AS rental_amount, r.eligible, r.earned_at, a.data AS appointment,
      c.data AS creative, c.employee_id AS creative_employee
    FROM flagged f
    LEFT JOIN payroll_rental_earnings r ON f.source_kind = 'rental' AND r.employee_id = f.employee_id
      AND r.rental_id = f.source_id AND r.generation = (SELECT generation FROM payroll_state WHERE id = 1)
    LEFT JOIN team_appointments a ON f.source_kind = 'rental' AND a.id = f.source_id
      AND a.generation = (SELECT generation FROM team_state WHERE id = 1)
    LEFT JOIN team_creative_assignments c ON f.source_kind = 'creative' AND c.id = f.source_id
    ORDER BY f.employee_id, f.credited_at, f.source_kind, f.source_id`).bind(null, null).all();
  const reviews = rows.results.map(row => {
    const appointment = row.appointment ? JSON.parse(row.appointment) : null;
    const work = row.creative ? JSON.parse(row.creative) : null;
    const rental = row.source_kind === 'rental';
    const amount = rental ? row.rental_amount : work && row.creative_employee === row.employee_id ? work.amountCents : null;
    let code, reason, nextStep;
    if (rental && row.rental_amount === null) {
      code = 'rental_missing'; reason = 'This person’s earning is missing from the latest rental sync.';
      nextStep = appointment ? 'Check the rental’s assignment and response, then sync Calendar again.' : 'The rental is no longer in the current schedule. Use the saved reference to check its Calendar history before changing any pay.';
    } else if (!rental && !work) {
      code = 'task_missing'; reason = 'The task is no longer in the saved work records.';
      nextStep = 'Use the saved reference to check the task history before changing any pay.';
    } else if (!rental && row.creative_employee !== row.employee_id) {
      code = 'task_reassigned'; reason = 'The task is now assigned to a different person.';
      nextStep = 'Open the task and review its assignment. The original person’s advance credit remains saved.';
    } else if (rental && row.eligible !== 1) {
      code = 'rental_ineligible'; reason = 'This rental no longer qualifies as an earned payment.';
      nextStep = 'Check completion time, customer payment, and the person’s pay setup. Sync again after correcting the source record.';
    } else if (!rental && work.status !== 'approved') {
      code = 'task_unapproved'; reason = 'The task is no longer approved for payment.';
      nextStep = 'Open the task and review its current approval status.';
    } else {
      code = 'earning_reduced'; reason = 'The current earning is lower than the credit and prior cash already recorded.';
      nextStep = rental ? 'Check the rental price and pay rate, then sync again after correcting the source record.' : 'Open the task and check its approved pay amount.';
    }
    return {
      employeeId: row.employee_id, kind: row.source_kind, sourceId: row.source_id,
      title: (rental ? appointment?.title : work?.title) || (rental ? 'Rental earning' : 'Creative task'),
      customer: rental ? appointment?.customer || null : null,
      start: (rental ? appointment?.start : work?.dueAt) || null,
      end: (rental ? appointment?.end || row.earned_at : work?.approvedAt) || null,
      sourceAvailable: Boolean(rental ? appointment : work),
      appliedCents: Number(row.applied), cashFloorCents: Number(row.cash_floor),
      currentAmountCents: amount === null || amount === undefined ? null : Number(amount),
      creditedAt: row.credited_at, code, reason, nextStep,
    };
  });
  return { version: 1, checkedAt: new Date().toISOString(), reviews };
}
