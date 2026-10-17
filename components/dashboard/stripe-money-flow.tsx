"use client";

import { Button } from "@/components/ui/button";
import { dollars,formatDate,formatTime } from "@/lib/dashboard-presentation";
import type {
StripeSummary,
UnmatchedStripePayment
} from "@/lib/dashboard-types";
import {
CreditCard,
Landmark,
Link2,
TriangleAlert
} from "lucide-react";

export function StripeMoneyFlow({
  summary,
  unmatchedPayments,
  onMatch,
}: {
  summary?: StripeSummary;
  unmatchedPayments: UnmatchedStripePayment[];
  onMatch: (paymentId?: string) => void;
}) {
  if (!summary) {
    return (
      <section className="panel stripe-flow-panel stripe-flow-disconnected">
        <div className="stripe-flow-intro">
          <span className="stripe-flow-icon"><CreditCard size={21} /></span>
          <div><p className="eyebrow">Money flow</p><h2>Stripe is not connected yet</h2><p>Calendar payment fields remain active until the read-only Stripe sync is enabled.</p></div>
        </div>
      </section>
    );
  }

  const flowItems = [
    { label: "Gross received", value: summary.grossCents, note: `${summary.paymentCount} successful payment${summary.paymentCount === 1 ? "" : "s"}` },
    { label: "Refunded", value: summary.refundedCents, note: "Returned to customers" },
    { label: "Stripe fees", value: summary.feeCents, note: "Processing costs" },
    { label: "Net after fees", value: summary.netCents, note: "Gross minus refunds and fees" },
    { label: "Paid to bank", value: summary.bankPayoutCents, note: summary.pendingPayoutCents ? `${dollars(summary.pendingPayoutCents, true)} still moving` : "Completed Stripe payouts" },
  ];

  return (
    <section className="panel stripe-flow-panel">
      <div className="panel-heading stripe-flow-heading">
        <div><p className="eyebrow">Money flow</p><h2>Stripe reconciliation</h2></div>
        <span className="stripe-connected"><span /> Updated {formatDate(summary.generatedAt, true)} at {formatTime(summary.generatedAt)}</span>
      </div>
      <div className="stripe-flow-grid">
        {flowItems.map((item, index) => (
          <article key={item.label}>
            <span className="stripe-flow-item-icon">{index === 4 ? <Landmark size={16} /> : <CreditCard size={16} />}</span>
            <div><span>{item.label}</span><strong>{dollars(item.value, true)}</strong><small>{item.note}</small></div>
          </article>
        ))}
      </div>
      {summary.unmatchedPaymentCount > 0 && (
        <div className="stripe-unmatched">
          <div className="stripe-unmatched-heading">
            <span><TriangleAlert size={17} /></span>
            <div>
              <strong>{summary.unmatchedPaymentCount} Stripe payment{summary.unmatchedPaymentCount === 1 ? "" : "s"} need matching</strong>
              <small>{dollars(summary.unmatchedCents, true)} was received but could not be safely tied to a Calendar appointment.</small>
              <Button onClick={() => onMatch()} size="sm" variant="outline"><Link2 size={14} /> Match payments</Button>
            </div>
          </div>
          <div className="stripe-unmatched-list">
            {unmatchedPayments.slice(0, 5).map((payment) => (
              <button aria-label={`Match ${payment.customerName || payment.customerEmail || "unknown customer"} payment of ${dollars(payment.amountCents, true)}`} disabled={!payment.matchKey} key={`${payment.matchKey || payment.reference}-${payment.created}`} onClick={() => onMatch(payment.matchKey)} type="button">
                <span><strong>{payment.customerName || payment.customerEmail || "Unknown customer"}</strong><small>{formatDate(payment.created, true)} · ref {payment.reference}</small></span>
                <b>{dollars(payment.amountCents, true)}</b>
                <em>Match</em>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
