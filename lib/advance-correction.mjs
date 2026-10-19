// Explain the same eligibility conditions used by the rental payroll sync.
// These are saved rental details, not an authorization to change a payment.
export function advanceCorrectionChecks(review, rental, now = Date.now()) {
  if (review.kind !== 'rental' || !rental) return [];
  const payout = rental.employeePayouts?.[review.employeeId];
  return [
    { label: 'Rental completed', ok: Date.parse(rental.end) <= now,
      detail: Date.parse(rental.end) <= now ? 'The rental end time has passed.' : 'Pay becomes earned after the rental ends. Open the rental if its time is wrong.' },
    { label: 'Customer payment', ok: rental.fullyPaid === true,
      detail: rental.fullyPaid ? 'The customer is marked fully paid.' : 'The customer is not marked fully paid. If you received the balance, use Update customer payment. Otherwise leave this status as it is.' },
    { label: 'Person and pay rate', ok: Boolean(payout) && payout.compensationConfigured !== false,
      detail: !payout ? 'This person has no earning on this rental. Open the rental and check its assigned crew.' : payout.compensationConfigured === false ? 'This person needs a configured pay rate before the rental can earn pay.' : 'This person has a configured earning on the rental.' },
  ];
}
