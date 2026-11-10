"use client";
import { useClock } from "@/lib/use-clock";

import { useMemo } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { agendaOnDay, buildScheduleAgenda } from "@/lib/schedule-agenda.mjs";
import type { ScheduleEntry, WorkEntry } from "@/lib/schedule-calendar-types";
import type { TeamSchedule } from "@/lib/team-api";
import { addLocalDays, localInstant, STUDIO_ZONE, studioLocal } from "@/lib/team-schedule.mjs";
import { date, time } from "./shared";

export function EmployeeScheduleToolbar({ view, onView, onAvailability }: {
  view: "upcoming" | "past"; onView: (view: "upcoming" | "past") => void; onAvailability: () => void;
}) {
  return <div className="employee-schedule-toolbar">
    <nav className="employee-schedule-switch" aria-label="Schedule views">
      {(["upcoming", "past"] as const).map(value => <Button key={value} variant="ghost" aria-pressed={view === value} onClick={() => onView(value)}>{value === "upcoming" ? "Upcoming" : "Past"}</Button>)}
    </nav>
    <Button variant="outline" onClick={onAvailability}><CalendarDays size={16} />Availability</Button>
  </div>;
}

function workStatus(item: WorkEntry, userId: string) {
  const person = item.confirmations.find(person => person.employeeId === userId);
  if (item.appointment?.cancelled) return { label: "Cancelled", tone: "muted" };
  if (person?.appStatus === "pending") return { label: "Needs response", tone: "pending" };
  if (person?.appStatus === "accepted" || person?.calendarAccepted) return { label: "Confirmed", tone: "confirmed" };
  return { label: "Calendar invitation", tone: "pending" };
}

export function EmployeeScheduleWeek({ schedule, userId, week, onWeek, onOpen }: {
  schedule: TeamSchedule; userId: string; week: string; onWeek: (week: string) => void; onOpen: (item: WorkEntry) => void;
}) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addLocalDays(`${week}T00:00`, i).slice(0, 10)), [week]);
  const entries = useMemo(() => buildScheduleAgenda(schedule, {
    from: localInstant(`${week}T00:00`), to: localInstant(addLocalDays(`${week}T00:00`, 7)), employeeId: userId,
  }) as ScheduleEntry[], [schedule, userId, week]);
  const now = useClock();
  const today = studioLocal(now).slice(0, 10);
  return <article className="schedule-panel employee-week-panel">
    <div className="employee-week-heading">
      <div><h3>Week at a glance</h3><p>{date(localInstant(`${week}T12:00`))}–{date(localInstant(`${days[6]}T12:00`))}</p></div>
      <div className="schedule-actions">
        <Button size="icon" variant="outline" aria-label="Previous week" onClick={() => onWeek(addLocalDays(`${week}T00:00`, -7).slice(0, 10))}><ChevronLeft size={18} /></Button>
        <Button variant="outline" onClick={() => onWeek(today)}>Today</Button>
        <Button size="icon" variant="outline" aria-label="Next week" onClick={() => onWeek(addLocalDays(`${week}T00:00`, 7).slice(0, 10))}><ChevronRight size={18} /></Button>
      </div>
    </div>
    <div className="employee-week">{days.map(day => {
      const items = agendaOnDay(entries, day) as ScheduleEntry[];
      return <section className={`employee-week-day${day === today ? " is-today" : ""}`} key={day} aria-label={day}>
        <h4>{new Date(localInstant(`${day}T12:00`)).toLocaleDateString("en-US", { timeZone: STUDIO_ZONE, weekday: "short", month: "short", day: "numeric" })}</h4>
        {items.length === 0 ? <p className="employee-week-empty">No commitments</p> : <div className="employee-week-items">{items.map(item => {
          if (item.kind !== "work") return <div key={item.id} className="employee-week-entry employee-week-availability"><span className={`employee-work-status ${item.kind === "preference" ? "confirmed" : "muted"}`}>{item.kind === "preference" ? "Preferred" : "Unavailable"}</span><strong>{item.title}</strong><span>{item.allDay ? "Full day" : `${time(item.start)}–${time(item.end)}`}</span>{item.note && <small>{item.note}</small>}</div>;
          const status = workStatus(item, userId);
          return <button key={item.id} className="employee-week-entry employee-week-booking" onClick={() => onOpen(item)} aria-label={`Open ${item.customer || item.title}, ${date(item.start)} at ${time(item.start)}`}>
            <span className={`employee-work-status ${status.tone}`}>{status.label}</span><strong>{item.customer || item.title}</strong>{item.customer && <span className="employee-week-title">{item.title}</span>}<span>{time(item.start)}–{time(item.end)}</span>
          </button>;
        })}</div>}
      </section>;
    })}</div>
    <p className="employee-week-sync">{schedule.syncedAt ? `Synced ${date(schedule.syncedAt)} at ${time(schedule.syncedAt)} · ` : ""}Responses save immediately.</p>
  </article>;
}
