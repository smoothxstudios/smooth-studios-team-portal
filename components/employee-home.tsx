"use client";
import type { ReactNode } from "react";
import { ArrowRight, BookOpen, CalendarDays, ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { employeeHomeWork } from "@/lib/employee-home.mjs";
import { rentalSetupDetails } from "@/lib/rental-details.mjs";
import { RentalDescription } from "@/components/rental-description";
import { calendarInvitationLabel } from "@/lib/calendar-invitations.mjs";
import { formatDate, formatTime, dollars } from "@/lib/dashboard-presentation";
import type { Rental, AdvanceBalance } from "@/lib/dashboard-types";
import type { TeamAssignment, TeamSchedule } from "@/lib/team-api";

export type EmployeeHomeOptions = {
  rentals: Rental[]; owed: number; advance?: AdvanceBalance; work?: ReactNode; extras?: ReactNode;
  onSchedule: () => void; onAvailability: () => void; onEarnings: () => void; onGuide: () => void; onChecklist?: () => void;
};

export function EmployeeHome({ userId, schedule, loading, options, onBlockTime, renderOffer, onOpenRental }: {
  userId: string; schedule: TeamSchedule | null; loading: boolean; options: EmployeeHomeOptions;
  onBlockTime: () => void; renderOffer: (assignment: TeamAssignment) => ReactNode; onOpenRental: (id: string) => void;
}) {
  const { offers, updates, calendarInvitations, upcoming } = employeeHomeWork(userId, schedule, options.rentals);
  const next = upcoming[0];
  const setup = rentalSetupDetails(next?.rentalDetails);
  return <div className="employee-home">
    <section className="panel employee-home-next" aria-labelledby="employee-next-heading">
      <div className="employee-section-heading"><h2 id="employee-next-heading">{next && Date.parse(next.start) <= Date.now() ? "Happening now" : "Your next assignment"}</h2><Button variant="ghost" onClick={options.onSchedule}>Schedule<ArrowRight size={16} /></Button></div>
      {loading && !schedule ? <p role="status">Checking your assignments…</p> : next ? <div className="employee-next-action"><p>{formatDate(next.start)} · {formatTime(next.start)}–{formatTime(next.end)}</p><h3>{next.customer || next.title}</h3>{next.customer && <p>{next.title}</p>}{!schedule && <p className="schedule-warning">From the last sync. Open Schedule to confirm current details.</p>}{next.appointmentId && (setup ? <RentalDescription details={setup} heading="Rental setup" /> : <p className="schedule-small">Setup details aren’t available in the current booking. Confirm the backdrop and equipment with Smooth.</p>)}{next.instructions && <p className="schedule-instructions">{next.instructions}</p>}<Button onClick={() => next.appointmentId ? onOpenRental(next.appointmentId) : options.onSchedule()}>{next.appointmentId ? "View rental details" : "View assignment"}</Button>{upcoming.length > 1 && <Button variant="ghost" onClick={options.onSchedule}>{upcoming.length - 1} more upcoming</Button>}</div> : <p className="daily-empty">{offers.length ? "Accept an offer below to confirm your next assignment." : schedule ? "No confirmed work coming up." : "Current assignments couldn’t load. Try again above."}</p>}
    </section>
    {offers.length > 0 && <section className="panel employee-attention" aria-labelledby="employee-offers-heading"><div className="employee-section-heading"><h2 id="employee-offers-heading">Needs your response <span className="schedule-count">{offers.length}</span></h2></div><div className="schedule-offers">{offers.slice(0, 3).map(renderOffer)}</div>{offers.length > 3 && <Button variant="ghost" onClick={options.onSchedule}>View all {offers.length} offers</Button>}</section>}
    {options.work}
    {calendarInvitations.length > 0 && <section className="panel daily-action-list"><div className="panel-heading"><h2>Calendar invitations</h2></div>{calendarInvitations.slice(0, 3).map(item => <button className="daily-action-row" key={item.id} onClick={() => onOpenRental(item.id)}><span className="daily-action-copy"><strong>{item.customer || item.title}</strong><small>{formatDate(item.start)} · {formatTime(item.start)}</small><span className="daily-next-step">{calendarInvitationLabel(item.calendarStatus)} · view invitation</span></span><ArrowRight size={18} /></button>)}</section>}
    {updates.length > 0 && <details className="home-finances employee-updates"><summary>Schedule updates ({updates.length})<ChevronDown size={18} /></summary>{updates.map(item => <p key={item.id}><strong>Offer cancelled · {item.title}</strong><br />{formatDate(item.start)} · {formatTime(item.start)}. {item.note || "Smooth cancelled this dashboard offer."}</p>)}</details>}
    <button type="button" className="panel employee-earnings-card" onClick={options.onEarnings}>
      <span className="employee-earnings-card-top">
        <strong>Earnings</strong>
        <span className="employee-earnings-card-link">View earnings <ArrowRight size={16} aria-hidden="true" /></span>
      </span>
      <span className="employee-earnings-card-amount">
        <span>{options.advance?.remainingCents ? "Advance remaining" : "Pay owed"}</span>
        <strong>{dollars(options.advance?.remainingCents || options.owed)}</strong>
      </span>
    </button>
    <nav className="employee-shortcuts" aria-label="Employee shortcuts"><button className="panel employee-shortcut" onClick={options.onAvailability ?? (schedule ? onBlockTime : options.onSchedule)}><Plus size={20} /><span><strong>Update availability</strong></span><ArrowRight size={18} /></button><button className="panel employee-shortcut" onClick={options.onGuide}><BookOpen size={20} /><span><strong>Studio guidelines</strong></span><ArrowRight size={18} /></button></nav>
    {options.extras}
  </div>;
}
