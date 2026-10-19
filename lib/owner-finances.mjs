import { studioLocal, localInstant, addLocalDays } from "./team-schedule.mjs";
import { creativePaid, creativeEarningDate } from "./creative-work.mjs";

/** Calendar periods use studio midnights, including 23/25-hour DST days. */
export function studioPeriods(now = Date.now()) {
  const today = studioLocal(now).slice(0, 10), year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7));
  const monday = addLocalDays(`${today}T00:00`, -((new Date(`${today}T12:00Z`).getUTCDay() + 6) % 7));
  const monthLocal = offset => new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 10) + 'T00:00';
  return [
    { label: 'This week', start: monday, previous: addLocalDays(monday, -7), end: addLocalDays(monday, 7) },
    { label: 'This month', start: monthLocal(0), previous: monthLocal(-1), end: monthLocal(1) },
    { label: 'This year', start: `${year}-01-01T00:00`, previous: `${year - 1}-01-01T00:00`, end: `${year + 1}-01-01T00:00` },
  ].map(period => ({ label: period.label, start: new Date(localInstant(period.start)), previous: new Date(localInstant(period.previous)), end: new Date(localInstant(period.end)) }));
}

export function customerFullyPaid(rental) {
  if (rental.paymentOverride !== undefined) return rental.fullyPaid;
  return rental.fullyPaid || (rental.paidOnlineCents !== null && rental.paidOnlineCents >= rental.priceCents);
}

export function tipAmount(rental) {
  return rental.tipCents ?? Math.max((rental.paidOnlineCents ?? 0) - rental.priceCents, 0);
}

export function recognizedRevenue(rental) {
  return customerFullyPaid(rental) ? rental.priceCents + tipAmount(rental) : 0;
}

/**
 * Appointment revenue belongs to its studio date once completed and fully paid.
 * Payroll includes all earned pay for that work, whether already paid or owed.
 * Approved creative work belongs to its approval date; manual pay uses its work date.
 * This is before fees and
 * other studio expenses, rather than a cash-receipts or bank-balance report.
 * @param {import('./dashboard-types').Rental[]} rentals
 * @param {import('./use-creative-work').CreativeAssignment[]} creative
 */
export function ownerPeriodFinances(rentals, creative = [], now = Date.now()) {
  const today = studioLocal(now).slice(0, 10);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const monday = addLocalDays(`${today}T00:00`, -((weekday + 6) % 7));
  return [
    { id: "week", label: "This week", start: localInstant(monday) },
    { id: "month", label: "This month", start: localInstant(`${today.slice(0, 7)}-01T00:00`) },
  ].map(period => {
    let revenue = 0, teamPay = 0, stillOwed = 0, missingRates = 0;
    const start = Date.parse(period.start);
    const inPeriod = value => Date.parse(value) >= start && Date.parse(value) <= now;
    for (const rental of rentals) {
      if (!inPeriod(rental.start) || !(Date.parse(rental.end) <= now) || !customerFullyPaid(rental)) continue;
      revenue += recognizedRevenue(rental);
      for (const payout of Object.values(rental.employeePayouts)) {
        if (payout.compensationConfigured === false) { missingRates++; continue; }
        teamPay += payout.amountCents;
        const paid = payout.paidAmountCents ?? (payout.paid ? payout.amountCents : 0);
        stillOwed += payout.outstandingCents ?? Math.max(payout.amountCents - paid, 0);
      }
    }
    for (const item of creative) {
      if (item.status !== "approved" || !item.approvedAt || !inPeriod(creativeEarningDate(item))) continue;
      teamPay += item.amountCents;
      stillOwed += Math.max(item.amountCents - creativePaid(item), 0);
    }
    return { ...period, revenue, teamPay, stillOwed, afterTeamPay: revenue - teamPay, missingRates };
  });
}
