/** Apply a recorded advance without counting a paid-through marker twice. */
export function applyRentalAdvance(payout, allocation) {
  if (!allocation) return payout;
  const recorded = payout.recordedPaidAmountCents ?? payout.paidAmountCents ?? (payout.paid ? payout.amountCents : 0);
  const advance = Math.min(payout.amountCents, allocation.amountCents);
  const cash = Math.min(payout.amountCents, Math.max(allocation.cashFloorCents, recorded - allocation.amountCents));
  const paid = Math.min(payout.amountCents, cash + advance);
  return { ...payout, recordedPaidAmountCents: recorded, cashPaidCents: cash, advanceAppliedCents: advance,
    paidAmountCents: paid, outstandingCents: Math.max(0, payout.amountCents - paid), paid: paid >= payout.amountCents };
}

/** @param {import('./dashboard-types').Rental[]} rentals
 * @param {import('./dashboard-types').PayrollState | undefined} payroll */
export function applyRentalAdvances(rentals, payroll) {
  if (!payroll) return rentals;
  const credits = new Map(payroll.allocations.filter(item => item.kind === 'rental').map(item => [`${item.employeeId}:${item.sourceId}`, item]));
  return rentals.map(rental => ({ ...rental, employeePayouts: Object.fromEntries(Object.entries(rental.employeePayouts)
    .map(([employee, payout]) => [employee, applyRentalAdvance(payout, credits.get(`${employee}:${rental.id}`))])) }));
}

export function scopedPayroll(payroll, employeeId) {
  return { ...payroll, balances: payroll.balances.filter(item => item.employeeId === employeeId),
    allocations: payroll.allocations.filter(item => item.employeeId === employeeId), reviewCount: 0, reviewPeople: [] };
}
