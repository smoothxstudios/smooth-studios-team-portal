import { studioLocal } from "./team-schedule.mjs";

/**
 * The live schedule is authoritative. Only fall back to the encrypted Calendar
 * snapshot when it cannot be loaded; otherwise a cancelled offer can reappear.
 * @param {string} userId
 * @param {import('./team-api').TeamSchedule | null} schedule
 * @param {import('./dashboard-types').Rental[]} rentals
 * @param {number} now
 */
export function employeeHomeWork(userId, schedule, rentals, now = Date.now()) {
  const assignments = (schedule?.assignments ?? []).filter(a => a.employeeId === userId);
  const current = a => Date.parse(a.end) > now;
  const byStart = (a, b) => Date.parse(a.start) - Date.parse(b.start);
  const offers = assignments.filter(a => a.status === "pending" && current(a)).sort(byStart);
  const updates = assignments.filter(a => a.status === "cancelled" && current(a)).sort(byStart);
  /** @type {Map<string, {id: string, title: string, customer: string, start: string, end: string, instructions: string, rentalDetails?: string, note: string, status: string, appointmentId: string | null}>} */
  const work = new Map();
  if (schedule) {
    for (const a of schedule.appointments.filter(a => a.acceptedEmployeeIds.includes(userId) && current(a))) {
      work.set(a.id, { ...a, instructions: "", note: "", status: "Calendar accepted", appointmentId: a.id });
    }
    for (const a of assignments.filter(a => a.status === "accepted" && current(a))) {
      const appointment = schedule.appointments.find(p => p.id === a.appointmentId);
      const key = a.appointmentId ?? a.id;
      work.set(key, { id: key, title: appointment?.title ?? a.title, customer: appointment?.customer ?? "",
        start: a.start, end: a.end, rentalDetails: appointment?.rentalDetails, instructions: a.instructions, note: a.note ?? "", status: "Accepted", appointmentId: a.appointmentId });
    }
  } else {
    for (const rental of rentals.filter(r => r.assignedEmployeeIds.includes(userId) && current(r))) {
      work.set(rental.id, { ...rental, instructions: "", note: "", status: "Previously synced", appointmentId: rental.id });
    }
  }
  return { offers, updates, upcoming: [...work.values()].sort(byStart) };
}

/** @param {import('./dashboard-types').Rental[]} rentals */
export function employeeEarningsForYear(rentals, employeeId, year, now = Date.now()) {
  const selected = rentals.filter(r => r.assignedEmployeeIds.includes(employeeId) && studioLocal(r.start).slice(0, 4) === String(year));
  const metrics = { revenue: 0, owed: 0, paid: 0, projected: 0 };
  const monthly = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(month => ({ month, paid: 0, owed: 0 }));
  for (const rental of selected) {
    const payout = rental.employeePayouts[employeeId];
    if (!payout) continue;
    const paid = payout.paidAmountCents ?? (payout.paid ? payout.amountCents : 0);
    const unpaid = payout.outstandingCents ?? Math.max(payout.amountCents - paid, 0);
    const fullyPaid = rental.paymentOverride !== undefined ? rental.fullyPaid : rental.fullyPaid || (rental.paidOnlineCents !== null && rental.paidOnlineCents >= rental.priceCents);
    const upcoming = Date.parse(rental.end) > now;
    const owed = !upcoming && fullyPaid && !payout.paid ? unpaid : 0;
    metrics.paid += paid;
    metrics.owed += owed;
    if (upcoming) metrics.projected += payout.amountCents;
    const month = Number(studioLocal(rental.start).slice(5, 7)) - 1;
    monthly[month].paid += paid;
    monthly[month].owed += owed;
  }
  return { rentals: selected, metrics, monthly };
}
