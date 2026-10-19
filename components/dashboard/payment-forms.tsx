"use client";

import { EmptyState } from "@/components/dashboard/shared";
import { type OwnerWorkflowRequest } from "@/components/github-workflow-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
Dialog,
DialogContent,
DialogDescription,
DialogFooter,
DialogHeader,
DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { dollars,formatDate,formatTime,normalizedMatchText,stripeAppointmentScore } from "@/lib/dashboard-presentation";
import type {
Rental,
UnmatchedStripePayment
} from "@/lib/dashboard-types";
import {
Check,
Search
} from "lucide-react";
import { useEffect,useMemo,useRef,useState } from "react";

export function PaymentOverrideForm({
  open,
  onOpenChange,
  onContinue,
  reviewRentals,
  initialEventId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContinue: (request: OwnerWorkflowRequest) => void;
  reviewRentals: Rental[];
  initialEventId?: string;
}) {
  const [eventId, setEventId] = useState("");
  const [paidStatus, setPaidStatus] = useState<"true" | "false" | "clear">("true");
  const initialized = useRef(false);

  useEffect(() => {
    if (!open) { initialized.current = false; return; }
    if (initialized.current) return;
    const resetTimer = window.setTimeout(() => {
      initialized.current = true;
      setEventId(reviewRentals.some(rental => rental.id === initialEventId) ? initialEventId! : reviewRentals[0]?.id ?? "");
      setPaidStatus("true");
    }, 0);
    return () => window.clearTimeout(resetTimer);
  }, [open, reviewRentals, initialEventId]);

  const selected = reviewRentals.find((rental) => rental.id === eventId);
  const statusLabels = { true: "Payment received by invoice, cash, or other", false: "Not fully paid", clear: "Use automatic payment records" };
  const continueToConfirmation = () => {
    if (!selected) return;
    const recorded = selected.paidOnlineCents === null ? "None" : dollars(selected.paidOnlineCents, true);
    onOpenChange(false);
    onContinue({
      workflowId: "override-payment.yml",
      title: "Update customer payment",
      description: paidStatus === "true"
        ? "This confirms that the remaining balance was received by invoice, cash, or another method."
        : paidStatus === "false"
          ? "This records that the appointment is not fully paid."
          : "This removes the manual decision and returns the appointment to its automatic Stripe or Calendar payment status.",
      actionLabel: paidStatus === "true" ? "Confirm payment received" : paidStatus === "false" ? "Mark not fully paid" : "Clear manual status",
      inputs: { event_id: selected.id, paid_status: paidStatus },
      details: [
        { label: "Appointment", value: `${selected.customer} · ${selected.title}` },
        { label: "Date", value: `${formatDate(selected.start, true)} at ${formatTime(selected.start)}` },
        { label: "Price", value: dollars(selected.priceCents, true) },
        { label: selected.paymentSource === "stripe" ? "Stripe received" : "Calendar “Paid Online”", value: recorded },
        { label: "New status", value: statusLabels[paidStatus] },
      ],
    });
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="payment-override-dialog">
        <DialogHeader>
          <p className="eyebrow">Payment review</p>
          <DialogTitle>Update customer payment</DialogTitle>
          <DialogDescription>Only completed appointments with an unresolved balance appear here.</DialogDescription>
        </DialogHeader>
        {reviewRentals.length ? (
          <>
            <div className="workflow-form-field">
              <label htmlFor="payment-event">Appointment needing review</label>
              <select id="payment-event" onChange={(event) => setEventId(event.target.value)} value={eventId}>
                {reviewRentals.map((rental) => (
                  <option key={rental.id} value={rental.id}>
                    {formatDate(rental.start, true)} · {rental.customer} · {dollars(rental.priceCents, true)}
                  </option>
                ))}
              </select>
            </div>
            <div className="workflow-form-field">
              <label htmlFor="payment-status">Payment decision</label>
              <select id="payment-status" onChange={(event) => setPaidStatus(event.target.value as "true" | "false" | "clear")} value={paidStatus}>
                <option value="true">Payment received by invoice, cash, or other</option>
                <option value="false">Not fully paid</option>
                <option value="clear">Clear manual status</option>
              </select>
            </div>
            {selected && (
              <div className="payment-override-summary">
                <div><span>Price</span><strong>{dollars(selected.priceCents, true)}</strong></div>
                <div><span>{selected.paymentSource === "stripe" ? "Stripe received" : "Calendar “Paid Online”"}</span><strong>{selected.paidOnlineCents === null ? "None" : dollars(selected.paidOnlineCents, true)}</strong></div>
                <div><span>Remaining</span><strong>{dollars(Math.max(selected.priceCents - (selected.paidOnlineCents ?? 0), 0), true)}</strong></div>
              </div>
            )}
          </>
        ) : (
          <EmptyState copy="Every completed appointment currently has its full payment recorded." title="No payment review needed" />
        )}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">{selected ? "Cancel" : "Close"}</Button>
          {selected && <Button className="workflow-run-button" onClick={continueToConfirmation}>Continue</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StripeMatchForm({
  open,
  onOpenChange,
  onContinue,
  payments,
  rentals,
  initialPaymentId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContinue: (request: OwnerWorkflowRequest) => void;
  payments: UnmatchedStripePayment[];
  rentals: Rental[];
  initialPaymentId: string;
}) {
  const [paymentId, setPaymentId] = useState("");
  const [eventId, setEventId] = useState("");
  const [query, setQuery] = useState("");
  const matchablePayments = useMemo(() => payments.filter((payment) => Boolean(payment.matchKey)), [payments]);
  const initialized = useRef(false);

  useEffect(() => {
    if (!open) { initialized.current = false; return; }
    if (initialized.current) return;
    const resetTimer = window.setTimeout(() => {
      initialized.current = true;
      setPaymentId(initialPaymentId || matchablePayments[0]?.matchKey || "");
      setEventId("");
      setQuery("");
    }, 0);
    return () => window.clearTimeout(resetTimer);
  }, [initialPaymentId, matchablePayments, open]);

  const selectedPayment = matchablePayments.find((payment) => payment.matchKey === paymentId);
  const sortedRentals = useMemo(() => {
    if (!selectedPayment) return [];
    return [...rentals].sort((a, b) => {
      const scoreDifference = stripeAppointmentScore(selectedPayment, b) - stripeAppointmentScore(selectedPayment, a);
      return scoreDifference || new Date(b.start).getTime() - new Date(a.start).getTime();
    });
  }, [rentals, selectedPayment]);
  const matchingRentals = useMemo(() => {
    const words = normalizedMatchText(query).split(" ").filter(Boolean);
    const filtered = words.length
      ? sortedRentals.filter((rental) => {
        const searchable = normalizedMatchText(`${rental.customer} ${rental.title} ${rental.category ?? ""} ${formatDate(rental.start)} ${dollars(rental.priceCents, true)}`);
        return words.every((word) => searchable.includes(word));
      })
      : sortedRentals;
    return filtered.slice(0, 16);
  }, [query, sortedRentals]);
  const selectedRental = rentals.find((rental) => rental.id === eventId);

  const changePayment = (nextPaymentId: string) => {
    setPaymentId(nextPaymentId);
    setEventId("");
    setQuery("");
  };

  const continueToConfirmation = () => {
    if (!selectedPayment || !selectedRental?.stripeMatchKey) return;
    onOpenChange(false);
    onContinue({
      workflowId: "match-stripe-payment.yml",
      title: "Match Stripe payment",
      description: "This links this Stripe charge to the selected Calendar appointment. Deposits, final payments, and tips can each be linked to the same appointment.",
      actionLabel: "Save payment match",
      inputs: { charge_key: selectedPayment.matchKey, event_key: selectedRental.stripeMatchKey ?? "" },
      details: [
        { label: "Stripe payment", value: `${selectedPayment.customerName || selectedPayment.customerEmail || "Unknown customer"} · ${dollars(selectedPayment.amountCents, true)}` },
        { label: "Payment date", value: `${formatDate(selectedPayment.created, true)} · ref ${selectedPayment.reference}` },
        { label: "Calendar appointment", value: `${selectedRental.customer} · ${selectedRental.title}` },
        { label: "Appointment date", value: `${formatDate(selectedRental.start, true)} at ${formatTime(selectedRental.start)}` },
        { label: "Appointment price", value: dollars(selectedRental.priceCents, true) },
      ],
    });
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="stripe-match-dialog">
        <DialogHeader>
          <p className="eyebrow">Stripe reconciliation</p>
          <DialogTitle>Match payment to appointment</DialogTitle>
          <DialogDescription>Select the Stripe payment, then choose the Calendar appointment it belongs to. Leave unrelated payments unmatched—they still count in Stripe totals.</DialogDescription>
        </DialogHeader>
        {matchablePayments.length ? (
          <>
            <div className="workflow-form-field">
              <label htmlFor="stripe-payment">Stripe payment</label>
              <select id="stripe-payment" onChange={(event) => changePayment(event.target.value)} value={paymentId}>
                {matchablePayments.map((payment) => (
                  <option key={payment.matchKey} value={payment.matchKey}>
                    {formatDate(payment.created, true)} · {payment.customerName || payment.customerEmail || "Unknown customer"} · {dollars(payment.amountCents, true)}
                  </option>
                ))}
              </select>
            </div>
            {selectedPayment && (
              <div className="stripe-payment-summary">
                <div><span>Customer</span><strong>{selectedPayment.customerName || selectedPayment.customerEmail || "Unknown"}</strong></div>
                <div><span>Received</span><strong>{dollars(selectedPayment.amountCents, true)}</strong></div>
                <div><span>Reference</span><strong>{selectedPayment.reference}</strong></div>
              </div>
            )}
            <div className="stripe-appointment-picker">
              <label htmlFor="appointment-search">Calendar appointment</label>
              <div className="stripe-search-field"><Search size={17} /><Input autoComplete="off" id="appointment-search" onChange={(event) => setQuery(event.target.value)} placeholder="Search customer, package, date, or price" type="search" value={query} /></div>
              <div aria-label="Calendar appointment choices" className="stripe-appointment-list" role="listbox">
                {matchingRentals.length ? matchingRentals.map((rental, index) => {
                  const selected = rental.id === eventId;
                  const likely = !query && index < 3 && selectedPayment && stripeAppointmentScore(selectedPayment, rental) >= 80;
                  return (
                    <button aria-selected={selected} className={selected ? "selected" : ""} key={rental.id} onClick={() => setEventId(rental.id)} role="option" type="button">
                      <span className="stripe-appointment-date"><strong>{formatDate(rental.start, true)}</strong><small>{formatTime(rental.start)}</small></span>
                      <span className="stripe-appointment-copy"><strong>{rental.customer}</strong><small>{rental.title}</small></span>
                      {likely && <Badge variant="secondary">Possible match</Badge>}
                      <span className="stripe-appointment-amount"><strong>{dollars(rental.priceCents, true)}</strong><small>{rental.paidOnlineCents === null ? "No payment linked" : `${dollars(rental.paidOnlineCents, true)} recorded`}</small></span>
                      <span className="stripe-appointment-check">{selected && <Check size={16} />}</span>
                    </button>
                  );
                }) : <EmptyState copy="Try the customer's last name, package name, month, or price." title="No appointments found" />}
              </div>
              {!query && sortedRentals.length > matchingRentals.length && <small className="stripe-picker-note">Showing the closest possibilities first. Search to find any other 2026 appointment.</small>}
            </div>
          </>
        ) : <EmptyState copy={payments.length ? "Run Sync now once to prepare these payments for manual matching." : "The next Stripe sync will add any payments that still need matching."} title={payments.length ? "One more sync needed" : "No unmatched payments"} />}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">Cancel</Button>
          <Button className="workflow-run-button" disabled={!selectedPayment || !selectedRental?.stripeMatchKey} onClick={continueToConfirmation}>Continue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
