"use client";

import {
Table,
TableBody,
TableCell,
TableHead,
TableHeader,
TableRow,
} from "@/components/ui/table";
import type { AppointmentStatus } from "@/lib/dashboard-presentation";
import { FALLBACK_PROFILES,appointmentCategory,appointmentStatus,dollars,durationLabel,formatDate,formatTime,paidEarnings,teamAccent,unpaidEarnings } from "@/lib/dashboard-presentation";
import type {
EmployeePayout,
Rental
} from "@/lib/dashboard-types";
import { tipAmount } from "@/lib/owner-finances.mjs";

export function EmployeeEarnings({ payout }: { payout?: EmployeePayout }) {
  return <div className="payment-amount"><strong className="share-amount">{payout?.compensationConfigured === false ? "Rate needed" : dollars(payout?.amountCents ?? 0, true)}</strong>
    {Boolean(payout?.advanceAppliedCents) && <span className="payment-detail">{dollars(payout!.advanceAppliedCents!, true)} covered by advance</span>}
    {payout?.compensationLabel && <span className="payment-detail">{payout.compensationLabel}</span>}
    {paidEarnings(payout) > 0 && unpaidEarnings(payout) > 0 && <span className="payment-detail payment-detail-review">{dollars(paidEarnings(payout), true)} paid · {dollars(unpaidEarnings(payout), true)} still owed</span>}
  </div>;
}

export function CategoryBadge({ rental }: { rental: Rental }) {
  const category = appointmentCategory(rental);
  return <span className={`category-badge category-${category.id}`}>{category.label}</span>;
}

export function StatusBadge({ state }: { state: AppointmentStatus }) {
  const labels: Record<AppointmentStatus, string> = {
    upcoming: "Upcoming",
    "upcoming-paid": "Upcoming · paid",
    earned: "Earned",
    paid: "Paid out",
    awaiting: "Payment pending",
    deposit: "Deposit paid",
    review: "Review balance",
    "customer-paid": "Customer paid",
  };
  return <span className={`status status-${state}`}><span />{labels[state]}</span>;
}

export function PaymentAmount({ rental, showDetails }: { rental: Rental; showDetails: boolean }) {
  const paidOnline = rental.paidOnlineCents ?? 0;
  const tip = tipAmount(rental);
  const remaining = Math.max(rental.priceCents - paidOnline, 0);
  let detail = "No online payment recorded";
  let tone = "pending";
  const source = rental.paymentSource === "stripe" ? "Stripe" : rental.paymentSource === "manual" ? "manual review" : "Calendar";

  if (rental.paymentOverride === false) {
    detail = `${paidOnline > 0 ? `${dollars(paidOnline, true)} recorded · ` : ""}marked not fully paid`;
    tone = "review";
  } else if (rental.stripePayment?.disputed) {
    detail = `${dollars(paidOnline, true)} received · dispute needs review`;
    tone = "review";
  } else if (rental.paymentOverride === true && remaining > 0) {
    detail = paidOnline > 0 ? `${dollars(paidOnline, true)} online · payment confirmed` : "Payment confirmed manually";
    tone = "paid";
  } else if (tip > 0) {
    detail = `${dollars(paidOnline, true)} via ${source} · ${dollars(tip, true)} tip`;
    tone = "tip";
  } else if (remaining > 0 && paidOnline > 0) {
    detail = `${dollars(paidOnline, true)} via ${source} · ${dollars(remaining, true)} remaining`;
    tone = "deposit";
  } else if (paidOnline >= rental.priceCents) {
    detail = `${dollars(paidOnline, true)} received via ${source}`;
    tone = "paid";
  }

  return <div className="payment-amount"><strong>{dollars(rental.priceCents, true)}</strong>{showDetails && <span className={`payment-detail payment-detail-${tone}`}>{detail}</span>}</div>;
}

export function RentalTable({ rentals, employeeId }: { rentals: Rental[]; employeeId?: string }) {
  return (
    <Table className="rental-table" role="table" aria-label="Appointments">
      <TableHeader role="rowgroup"><TableRow role="row"><TableHead role="columnheader">Appointment</TableHead><TableHead role="columnheader">Category</TableHead><TableHead role="columnheader">Date & time</TableHead><TableHead role="columnheader">{employeeId ? "Price" : "Price / recorded payment"}</TableHead><TableHead role="columnheader">{employeeId ? "Your earnings" : "Assigned team"}</TableHead><TableHead role="columnheader">Status</TableHead></TableRow></TableHeader>
      <TableBody role="rowgroup">
        {rentals.map((rental) => (
          <TableRow key={rental.id} role="row">
            <TableCell className="rental-name-cell" role="cell"><div className="rental-name"><strong>{rental.customer}</strong><span>{rental.title}</span></div></TableCell>
            <TableCell className="rental-category-cell" role="cell"><CategoryBadge rental={rental} /></TableCell>
            <TableCell className="rental-date-cell" data-label="Date & time" role="cell"><div className="rental-date"><strong>{formatDate(rental.start, true)}</strong><span>{formatTime(rental.start)} · {durationLabel(rental)}</span></div></TableCell>
            <TableCell className="money-cell" data-label={employeeId ? "Price" : "Price / payment"} role="cell"><PaymentAmount rental={rental} showDetails={!employeeId} /></TableCell>
            <TableCell data-label={employeeId ? "Your earnings" : "Assigned team"} role="cell">
              {employeeId ? <EmployeeEarnings payout={rental.employeePayouts[employeeId]} /> : <div className="avatar-stack">{rental.assignedEmployeeIds.length ? rental.assignedEmployeeIds.map((id) => <span aria-label={FALLBACK_PROFILES.find(profile => profile.id === id)?.label ?? id} key={id} style={{ background: teamAccent(id) }}>{id.slice(0, 1).toUpperCase()}</span>) : <em>Unassigned</em>}</div>}
            </TableCell>
            <TableCell className="rental-status-cell" data-label="Status" role="cell"><StatusBadge state={appointmentStatus(rental, employeeId)} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
