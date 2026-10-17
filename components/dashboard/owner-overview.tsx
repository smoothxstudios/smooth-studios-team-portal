"use client";

import { EmptyState } from "@/components/dashboard/shared";
import { STUDIO_TIME_ZONE,durationLabel,formatDate,formatTime } from "@/lib/dashboard-presentation";
import type {
Rental
} from "@/lib/dashboard-types";
import {
ArrowRight,
Check,
ChevronRight,
Link2,
ReceiptText
} from "lucide-react";

export function OwnerAttention({ reviewCount, unmatchedCount, stripeConnected, onReview, onMatch, onPayouts }: {
  reviewCount: number; unmatchedCount: number; stripeConnected: boolean;
  onReview: () => void; onMatch: () => void; onPayouts: () => void;
}) {
  return (
    <article className="panel owner-attention">
      <div className="panel-heading"><h2>Needs attention</h2></div>
      <div className="owner-attention-list">
        {reviewCount > 0 && <button className="owner-attention-item" onClick={onReview}>
          <span className="owner-action-icon"><ReceiptText size={19} /></span>
          <span><strong>Review appointment payments</strong><small>{reviewCount} appointment{reviewCount === 1 ? "" : "s"} with an unconfirmed balance</small></span>
          <ChevronRight size={17} />
        </button>}
        {unmatchedCount > 0 && <button className="owner-attention-item" onClick={onMatch}>
          <span className="owner-action-icon"><Link2 size={19} /></span>
          <span><strong>Match Stripe payments</strong><small>{unmatchedCount} received payment{unmatchedCount === 1 ? "" : "s"} to link</small></span>
          <ChevronRight size={17} />
        </button>}
        {!reviewCount && !unmatchedCount && <div className="owner-attention-empty">
          <span><Check size={21} /></span><strong>No payment reviews waiting</strong>
          <p>{stripeConnected ? "Appointment balances and Stripe matches are up to date." : "No appointment balances need review."}</p>
        </div>}
      </div>
      <button className="owner-panel-link" onClick={onPayouts}>Manage team payouts <ArrowRight size={16} /></button>
    </article>
  );
}

export function OwnerUpcoming({ rentals, onSchedule }: { rentals: Rental[]; onSchedule: () => void }) {
  return (
    <article className="panel owner-upcoming">
      <div className="panel-heading"><div><h2>Coming up</h2><p>Next on your calendar</p></div><button onClick={onSchedule}>Open schedule <ChevronRight size={15} /></button></div>
      {rentals.length ? <ol className="owner-upcoming-list">
        {rentals.slice(0, 4).map(rental => <li key={rental.id}>
          <time className="owner-date-block" dateTime={rental.start} aria-label={formatDate(rental.start)}>
            <span>{new Intl.DateTimeFormat("en-US", { timeZone: STUDIO_TIME_ZONE, month: "short" }).format(new Date(rental.start))}</span>
            <strong>{new Intl.DateTimeFormat("en-US", { timeZone: STUDIO_TIME_ZONE, day: "numeric" }).format(new Date(rental.start))}</strong>
          </time>
          <div className="owner-appointment-copy"><strong>{rental.customer}</strong><span>{rental.title}</span></div>
          <div className="owner-appointment-time"><strong>{formatTime(rental.start)}</strong><span>{durationLabel(rental)}</span></div>
        </li>)}
      </ol> : <EmptyState title="Nothing coming up yet" copy="New Calendar appointments will appear here after syncing." />}
    </article>
  );
}
