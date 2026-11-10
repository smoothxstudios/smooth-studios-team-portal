import { rentalDeductionDateEligible } from '../../lib/team-rental-policy.mjs';

/** Read-only assertions; never log customer data or change saved payments. */
export function verifyRentalDeductions(payroll, rentals, asOf) {
  if (!Array.isArray(payroll?.rentalCharges) || !Array.isArray(payroll?.accounts)) throw new Error('Rental deduction accounts are missing.');
  const expected = new Map(rentals.map(rental => [rental.id, rental]));
  const seen = new Set();
  for (const charge of payroll.rentalCharges) {
    const key = JSON.stringify([charge.employeeId, charge.rentalId]);
    if (seen.has(key)) throw new Error('A rental deduction was counted twice.');
    seen.add(key);
    if (charge.needsReview && !charge.startAt) continue; // Preserve corrections for removed or reassigned bookings.
    const rental = expected.get(charge.rentalId);
    if (!rental || !rentalDeductionDateEligible(rental.start)) throw new Error('A rental deduction is outside the eligible date range.');
    // Calendar descriptions retain their UTC offset; the API normalizes to UTC.
    if (Date.parse(charge.startAt) !== Date.parse(rental.start)) throw new Error('A rental deduction has a different booking date.');
    if (charge.amountCents !== Math.max(0, rental.priceCents)) throw new Error('A rental deduction does not use the full booking price.');
    if (charge.outstandingCents !== Math.max(0, charge.amountCents - charge.appliedCents)) throw new Error('A saved payroll deduction was not credited correctly.');
  }
  for (const rental of rentals.filter(r => r.teamRenterId && !r.cancelled &&
      rentalDeductionDateEligible(r.start) && Date.parse(r.end) <= Date.parse(asOf))) {
    if (!seen.has(JSON.stringify([rental.teamRenterId, rental.id]))) throw new Error('An eligible completed team rental is missing its deduction.');
  }
  for (const account of payroll.accounts) {
    const total = payroll.rentalCharges.filter(c => c.employeeId === account.employeeId).reduce((sum, c) => sum + c.outstandingCents, 0);
    if (account.rentalBalanceCents !== total || account.payableCents !== Math.max(0, account.grossOwedCents - total)) {
      throw new Error('A current account does not include its rental deductions.');
    }
  }
}
