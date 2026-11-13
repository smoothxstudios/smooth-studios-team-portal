"use client";
import { useState } from "react";
import { TEAM, studioLocal, addLocalDays } from "@/lib/team-schedule.mjs";
import { dayAvailability } from "@/lib/day-availability.mjs";
import { PersonAvatar } from "@/components/team-profile";
import type { TeamSchedule } from "@/lib/team-api";
import { AppSelect } from "@/components/ui/app-controls";
import { Input } from "@/components/ui/input";
import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
const time = (s: string) => new Date(s).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
export function AvailabilityOverview({ schedule, filter, onFilterChange }: { schedule: TeamSchedule; filter: string; onFilterChange: (value: string) => void }) {
  const [day, setDay] = useState(() => studioLocal(Date.now()).slice(0, 10));
  const people = TEAM.filter(p => filter === "all" || filter === p.id);
  return <section className="availability-overview">
    <div className="availability-overview-heading"><h2>Daily availability</h2><Button variant="outline" className="availability-today" onClick={() => setDay(studioLocal(Date.now()).slice(0, 10))}>Today</Button></div>
    <div className="availability-controls">
      <AppSelect aria-label="Team member" value={filter} onValueChange={onFilterChange}><option value="all">Everyone</option>{TEAM.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</AppSelect>
      <div className="availability-date-controls" role="group" aria-label="Choose day">
        <Button variant="ghost" size="icon" aria-label="Previous day" onClick={() => setDay(addLocalDays(`${day}T00:00`, -1).slice(0, 10))}><ChevronLeft size={18} /></Button>
        <Input aria-label="Availability day" type="date" value={day} onChange={e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) setDay(e.target.value); }} />
        <Button variant="ghost" size="icon" aria-label="Next day" onClick={() => setDay(addLocalDays(`${day}T00:00`, 1).slice(0, 10))}><ChevronRight size={18} /></Button>
      </div>
    </div>
    <p className="availability-overview-hint">Studio hours: noon–10 PM</p>
    <div className="availability-daily-list">{people.map(person => {
      const dayInfo = dayAvailability(person.id, day, schedule);
      const span = (p: { start: string; end: string }) => `${time(p.start < dayInfo.start ? dayInfo.start : p.start)}–${time(p.end >= dayInfo.end ? dayInfo.end : p.end)}`;
      const freeLabel = dayInfo.free.map(span).join(" · ");
      const inactive = person.id !== "owner" && schedule.activeEmployeeIds && !schedule.activeEmployeeIds.includes(person.id);
      const label = person.seasonal ? "Seasonal" : inactive ? "Inactive" : dayInfo.status === "available" ? "Available" : dayInfo.status === "partial" ? "Partly available" : "Unavailable";
      return <details className="availability-daily-person" key={`${day}-${person.id}`}><summary><PersonAvatar personId={person.id} name={person.name} className="employee-avatar" /><span className="availability-daily-copy"><strong>{person.name}</strong><span>{person.seasonal ? "Not suggested automatically" : inactive ? "Not suggested until active" : freeLabel || "Busy during studio hours"}</span></span><span className={`availability-day-status is-${person.seasonal || inactive ? "inactive" : dayInfo.status}`}>{label}</span><ChevronDown size={16} aria-hidden="true" /></summary><div className="availability-daily-details">
        {(person.seasonal || inactive) && <p>Free time: {freeLabel || "None this day"}</p>}
        {dayInfo.commitments.length ? dayInfo.commitments.map((p, i) => <p key={i}><strong>{span(p)}</strong><span>{p.label}</span></p>) : <p>No blocked time or bookings.</p>}
        {dayInfo.preferred.length > 0 && <p><strong>Preferred hours</strong><span>{dayInfo.preferred.map(span).join(" · ")}</span></p>}
      </div></details>;
    })}</div>
  </section>;
}
