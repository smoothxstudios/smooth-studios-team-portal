"use client";

import type { ReactNode } from "react";
import { ArrowRight, Banknote, BookOpen, CalendarDays, Check, ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { employeeHomeWork } from "@/lib/employee-home.mjs";
import { categorizeAppointment } from "@/lib/appointment-categories.mjs";
import { STUDIO_ZONE } from "@/lib/team-schedule.mjs";
import type { Rental } from "@/lib/dashboard-types";
import type { TeamAssignment, TeamSchedule } from "@/lib/team-api";

export type EmployeeHomeOptions = {
  rentals: Rental[];
  owed: number;
  onSchedule: () => void;
  onAvailability: () => void;
  onEarnings: () => void;
  onGuide: () => void;
};

const date = (value: string) => new Date(value).toLocaleDateString("en-US", { timeZone: STUDIO_ZONE, weekday: "short", month: "short", day: "numeric" });
const time = (value: string) => new Date(value).toLocaleTimeString("en-US", { timeZone: STUDIO_ZONE, hour: "numeric", minute: "2-digit" });

export function EmployeeHome({ userId, schedule, loading, options, onBlockTime, renderOffer }: {
  userId: string;
  schedule: TeamSchedule | null;
  loading: boolean;
  options: EmployeeHomeOptions;
  onBlockTime: () => void;
  renderOffer: (assignment: TeamAssignment) => ReactNode;
}) {
  const { offers, updates, upcoming } = employeeHomeWork(userId, schedule, options.rentals);
  return <div className="employee-home">
    {offers.length > 0 && <section className="panel employee-attention" aria-labelledby="employee-offers-heading">
      <div className="employee-section-heading"><div><p className="eyebrow">Needs your response</p><h2 id="employee-offers-heading">{offers.length === 1 ? "You have an assignment offer" : `${offers.length} assignment offers`}</h2></div></div>
      <div className="schedule-offers">{offers.map(renderOffer)}</div>
    </section>}

    {updates.length > 0 && <section className="employee-updates" aria-label="Schedule updates">
      {updates.map(item => <div className="schedule-notice" key={item.id}><CalendarDays size={18} /><div><strong>Offer cancelled · {item.title}</strong><p>{date(item.start)} · {time(item.start)}. {item.note || "Smooth cancelled this dashboard offer."}{item.appointmentId && schedule?.appointments.some(a => a.id === item.appointmentId && a.acceptedEmployeeIds.includes(userId)) ? " You still have an accepted Calendar invitation; check with Smooth." : ""}</p></div></div>)}
    </section>}

    {(loading || upcoming.length > 0 || offers.length === 0) && <section className="panel employee-home-next" aria-labelledby="employee-next-heading">
      <div className="employee-section-heading"><div><h2 id="employee-next-heading">Next assignments</h2><p>All times Eastern</p></div><Button variant="ghost" onClick={options.onSchedule}>View schedule <ArrowRight size={16} /></Button></div>
      {loading ? <p className="employee-empty" role="status">Checking your assignments…</p> : upcoming.length ? <div className="employee-work-list">{upcoming.slice(0, 3).map(item => {
        const category = item.appointmentId ? categorizeAppointment(item.title).label : "Assignment";
        return <details className="employee-work" key={item.id}>
          <summary><div className="employee-work-date"><strong>{date(item.start)}</strong><span>{time(item.start)}–{time(item.end)}{date(item.start) !== date(item.end) ? ` · ends ${date(item.end)}` : ""}</span></div>
            <div className="employee-work-title"><span>{category}</span><h3>{item.title}</h3>{item.customer && <p>{item.customer}</p>}</div>
            <span className={`schedule-status ${schedule ? "accepted" : ""}`}><Check size={13} />{Date.parse(item.start) <= Date.now() ? "In progress" : item.status}</span><ChevronDown className="employee-work-chevron" size={18} />
          </summary>
          <div className="employee-work-details"><h4>Preparation & instructions</h4><p>{item.instructions || "No additional instructions have been added for this assignment."}</p>{item.note && <p className="schedule-notice">{item.note}</p>}<Button variant="outline" onClick={options.onGuide}><BookOpen size={16} />Studio guidelines</Button></div>
        </details>;
      })}</div> : <div className="employee-empty"><CalendarDays size={28} /><h3>{schedule ? "You’re all caught up" : "No upcoming work in the last sync"}</h3><p>{schedule ? "Your next assignment will appear here. Keep your availability up to date so Smooth can schedule you." : "Check Schedule for new offers and your latest availability."}</p></div>}
    </section>}

    <section className="panel employee-pay" aria-label="Pay owed"><div className="employee-pay-label"><Banknote size={21} /><div><h2>Pay owed</h2><p>Earned and awaiting payout</p></div></div><strong>{(options.owed / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}</strong><Button variant="ghost" onClick={options.onEarnings}>View earnings <ArrowRight size={16} /></Button></section>

    <nav className="employee-shortcuts" aria-label="Employee shortcuts">
      <button className="panel employee-shortcut" onClick={options.onAvailability ?? (schedule ? onBlockTime : options.onSchedule)}><span className="employee-shortcut-icon"><Plus size={22} /></span><span><strong>Availability</strong><small>Choose work days or block time</small></span><ArrowRight size={18} /></button>
      <button className="panel employee-shortcut" onClick={options.onGuide}><span className="employee-shortcut-icon"><BookOpen size={22} /></span><span><strong>Studio guidelines</strong><small>Find answers and rental checklists</small></span><ArrowRight size={18} /></button>
    </nav>
  </div>;
}
