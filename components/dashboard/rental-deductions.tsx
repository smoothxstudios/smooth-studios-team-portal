import { ChevronDown } from "lucide-react";
import { dollars, formatDate } from "@/lib/dashboard-presentation";
import type { Employee, PayrollState, Rental } from "@/lib/dashboard-types";
import { rentalDeductionDateEligible } from "@/lib/team-rental-policy.mjs";

export function RentalDeductions({ charges, employees, rentals, isOwner }: {
  charges: NonNullable<PayrollState["rentalCharges"]>;
  employees: Employee[];
  rentals: Rental[];
  isOwner: boolean;
}) {
  const bookingDates = new Map(rentals.map(rental => [rental.id, rental.start]));
  const eligible = charges.filter(charge => {
    const start = charge.startAt ?? bookingDates.get(charge.rentalId);
    return start ? rentalDeductionDateEligible(start) : charge.needsReview;
  }).sort((a, b) => Date.parse(b.startAt ?? b.earnedAt) - Date.parse(a.startAt ?? a.earnedAt));
  if (!eligible.length) return null;
  return <details className="panel rental-deductions">
    <summary><h2>Rental deductions</h2><span className="rental-deductions-count">{eligible.length}</span><ChevronDown size={18} aria-hidden="true" /></summary>
    <div className="rental-deductions-content">
      <p>Full rental price deducted from pay. Rentals before Sep 25, 2026 are excluded.</p>
      <ul>{eligible.map(charge => <li key={`${charge.employeeId}:${charge.rentalId}`}>
        <div className="rental-deduction-description">
          <strong>{isOwner ? `${employees.find(person => person.id === charge.employeeId)?.name ?? charge.employeeId} · ` : ""}{charge.title}</strong>
          <span>{formatDate(charge.startAt ?? bookingDates.get(charge.rentalId) ?? charge.earnedAt)}{charge.appliedCents > 0 && !charge.needsReview ? charge.outstandingCents === 0 ? " · Applied" : " · Partly applied" : ""}</span>
        </div>
        <strong className="rental-deduction-amount">{charge.needsReview ? "Review" : `−${dollars(charge.amountCents, true)}`}</strong>
        {charge.needsReview && <p className="rental-deduction-review" role="alert">This rental changed after a deduction. Review its saved payment.</p>}
      </li>)}</ul>
    </div>
  </details>;
}
