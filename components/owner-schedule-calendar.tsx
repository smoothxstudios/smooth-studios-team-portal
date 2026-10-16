"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import type { ScheduleEntry, ScheduleView } from "@/lib/schedule-calendar-types";
import { calendarDayLayout, calendarMonth, moveCalendarMonth } from "@/lib/schedule-calendar.mjs";
import { agendaOnDay } from "@/lib/schedule-agenda.mjs";
import { STUDIO_ZONE, TEAM, studioLocal } from "@/lib/team-schedule.mjs";

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const label = (day: string) => new Date(`${day}T12:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" });
const monthLabel = (day: string) => new Date(`${day}T12:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
const time = (date: string) => new Date(date).toLocaleTimeString("en-US", { timeZone: STUDIO_ZONE, hour: "numeric", minute: "2-digit" });
const personName = (id: string) => TEAM.find(person => person.id === id)?.name ?? id;
const title = (item: ScheduleEntry) => item.kind === "work" ? item.customer || item.title : `${personName(item.userId)} · ${item.kind === "block" ? item.title : "Wants to work"}`;
const color = (item: ScheduleEntry) => item.kind === "block" ? "#71717a" : item.kind === "preference" ? "#168653" : item.employeeIds.length === 1 ? TEAM.find(person => person.id === item.employeeIds[0])?.color ?? "#2563eb" : "#2563eb";
function responseLabel(item: ScheduleEntry) {
  if (item.kind !== "work") return item.kind === "block" ? "Blocked" : "Prefers to work";
  return item.confirmations.length ? item.confirmations.map(person => `${personName(person.employeeId)}: ${person.appStatus === "accepted" ? "accepted in app" : person.appStatus === "pending" ? "awaiting app response" : "Calendar accepted"}`).join("; ") : "Unassigned";
}
const eventLabel = (item: ScheduleEntry) => `${title(item)}. ${time(item.start)}–${time(item.end)}. ${responseLabel(item)}. Open details.`;
function EventStatus({ item }: { item: ScheduleEntry }) {
  if (item.kind !== "work") return null;
  return item.status === "confirmed" ? <span className="calendar-event-check" aria-hidden="true">✅</span> : item.status === "pending" ? <Clock3 className="calendar-event-pending" size={14} aria-hidden="true" /> : null;
}

function MiniMonth({ selectedDay, today, entries, onDay, onNavigate }: {
  selectedDay: string; today: string; entries: ScheduleEntry[]; onDay: (day: string) => void; onNavigate: (day: string) => void;
}) {
  return <aside className="calendar-mini" aria-label="Month navigator">
    <div className="calendar-mini-heading"><strong>{monthLabel(selectedDay)}</strong><button type="button" aria-label="Previous month" onClick={() => onNavigate(moveCalendarMonth(selectedDay, -1))}><ChevronLeft size={16} /></button><button type="button" aria-label="Next month" onClick={() => onNavigate(moveCalendarMonth(selectedDay, 1))}><ChevronRight size={16} /></button></div>
    <div className="calendar-mini-grid">
      {weekdays.map(day => <span className="calendar-mini-weekday" key={day} aria-label={day}>{day.slice(0, 1)}</span>)}
      {(calendarMonth(selectedDay) as string[]).map(day => {
        const count = (agendaOnDay(entries, day) as ScheduleEntry[]).length;
        return <button type="button" className={`calendar-mini-day${day.slice(0, 7) !== selectedDay.slice(0, 7) ? " outside" : ""}`} key={day} aria-current={day === today ? "date" : undefined} aria-pressed={day === selectedDay} aria-label={`${label(day)}, ${count} events`} onClick={() => onDay(day)}><span>{Number(day.slice(-2))}</span>{count > 0 && <i aria-hidden="true" />}</button>;
      })}
    </div>
    <div className="calendar-key"><span><Check size={14} />Accepted</span><span><Clock3 size={14} />Awaiting response</span></div>
  </aside>;
}

function MonthGrid({ days, selectedDay, today, entries, onDay, onEvent }: {
  days: string[]; selectedDay: string; today: string; entries: ScheduleEntry[]; onDay: (day: string) => void; onEvent: (item: ScheduleEntry, day: string) => void;
}) {
  return <div className="calendar-month" aria-label={`${monthLabel(selectedDay)} calendar`}>
    <div className="calendar-month-weekdays">{weekdays.map(day => <div key={day}><abbr title={day}>{day.slice(0, 3)}</abbr></div>)}</div>
    <div className="calendar-month-days">{days.map(day => {
      const items = agendaOnDay(entries, day) as ScheduleEntry[];
      const outside = day.slice(0, 7) !== selectedDay.slice(0, 7);
      return <section className={`calendar-month-day${outside ? " outside" : ""}${day === today ? " is-today" : ""}`} key={day} aria-label={label(day)}>
        <button className="calendar-month-date" type="button" aria-current={day === today ? "date" : undefined} aria-label={`Open ${label(day)}, ${items.length} events`} onClick={() => onDay(day)}>{Number(day.slice(-2)) === 1 && <small>{new Date(`${day}T12:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short" })}</small>}<span>{Number(day.slice(-2))}</span></button>
        <div className="calendar-month-events">{items.slice(0, 3).map(item => <button className={`calendar-month-event ${item.kind}`} type="button" key={item.id} style={{ "--calendar-event-color": color(item) } as CSSProperties} aria-label={eventLabel(item)} onClick={() => onEvent(item, day)}><EventStatus item={item} /><span>{time(item.start)} · {title(item)}</span></button>)}{items.length > 3 && <button type="button" className="calendar-month-more" onClick={() => onDay(day)}>+{items.length - 3} more</button>}</div>
        {items.length > 0 && <button type="button" className="calendar-month-count" aria-label={`View ${items.length} events on ${label(day)}`} onClick={() => onDay(day)}><span aria-hidden="true">{items.slice(0, 3).map(item => <i key={item.id} style={{ background: color(item) }} />)}</span><strong>{items.length}</strong><small>{items.length === 1 ? "event" : "events"}</small></button>}
      </section>;
    })}</div>
  </div>;
}

type Segment = { item: ScheduleEntry; startMinute: number; endMinute: number; displayEnd: number; column: number; columns: number; continuesBefore: boolean; continuesAfter: boolean };
function TimeGrid({ days, today, now, entries, onDay, onEvent }: {
  days: string[]; today: string; now: number; entries: ScheduleEntry[]; onDay: (day: string) => void; onEvent: (item: ScheduleEntry, day: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const scrolledPeriod = useRef("");
  const period = days.join(",");
  useEffect(() => {
    if (!scroller.current || scrolledPeriod.current === period) return;
    const firstDay = period.split(",")[0];
    const earliest = (calendarDayLayout(entries, firstDay) as Segment[]).reduce((first, segment) => Math.min(first, segment.startMinute), 660);
    scroller.current.scrollTop = Math.max(0, earliest * 1.2 - 36);
    scrolledPeriod.current = period;
  }, [period, entries]);
  const nowLocal = studioLocal(now);
  const nowMinute = Number(nowLocal.slice(11, 13)) * 60 + Number(nowLocal.slice(14, 16));
  return <div className="calendar-time-scroll" ref={scroller} tabIndex={0} role="region" aria-label={days.length > 1 ? "Weekly calendar. Scroll to view other hours and days." : "Daily calendar. Scroll to view other hours."}>
    <div className={`calendar-time-inner${days.length === 1 ? " single-day" : ""}`} style={{ "--calendar-days": days.length } as CSSProperties}>
      <div className="calendar-time-header"><span className="calendar-time-zone">ET</span>{days.map(day => <button type="button" key={day} className={day === today ? "is-today" : ""} aria-current={day === today ? "date" : undefined} aria-label={`Open ${label(day)}`} onClick={() => onDay(day)}><span>{new Date(`${day}T12:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" })}</span><strong>{Number(day.slice(-2))}</strong></button>)}</div>
      <div className="calendar-time-body"><div className="calendar-time-axis" aria-hidden="true">{Array.from({ length: 24 }, (_, hour) => <span key={hour} style={{ top: hour * 72 }}>{hour % 12 || 12} {hour < 12 ? "AM" : "PM"}</span>)}</div>
        {days.map(day => <div className="calendar-time-day" key={day} aria-label={label(day)}>
          {(calendarDayLayout(entries, day) as Segment[]).map(segment => {
            const { item } = segment;
            const minutes = segment.displayEnd - segment.startMinute;
            return <button type="button" key={item.id} className={`calendar-time-event ${item.kind}${minutes < 50 ? " compact" : ""}`} style={{ top: segment.startMinute * 1.2, height: minutes * 1.2, left: `calc(${segment.column / segment.columns * 100}% + 2px)`, width: `calc(${100 / segment.columns}% - 4px)`, "--calendar-event-color": color(item) } as CSSProperties} aria-label={eventLabel(item)} onClick={() => onEvent(item, day)}>
              <span className="calendar-event-title"><EventStatus item={item} /><strong>{title(item)}</strong></span>
              <span className="calendar-event-time">{segment.continuesBefore ? "Continued · " : ""}{time(item.start)}–{time(item.end)}{segment.continuesAfter ? " · continues" : ""}</span>
              {minutes >= 75 && <span className="calendar-event-people">{item.kind === "work" ? item.employeeIds.length ? item.employeeIds.map(personName).join(", ") : "Unassigned" : item.kind === "block" ? "Blocked" : "Prefers to work"}</span>}
            </button>;
          })}
          {day === today && <div className="calendar-now" style={{ top: nowMinute * 1.2 }} aria-label={`Current time ${time(new Date(now).toISOString())}`} />}
        </div>)}
      </div>
    </div>
  </div>;
}

export function OwnerScheduleCalendar({ selectedDay, view, days, today, now, entries, monthEntries, onDay, onNavigate, onEvent }: {
  selectedDay: string; view: Exclude<ScheduleView, "list">; days: string[]; today: string; now: number;
  entries: ScheduleEntry[]; monthEntries: ScheduleEntry[]; onDay: (day: string) => void; onNavigate: (day: string) => void; onEvent: (item: ScheduleEntry, day: string) => void;
}) {
  return <div className={`owner-full-calendar ${view}`}>
    {view !== "month" && <MiniMonth selectedDay={selectedDay} today={today} entries={monthEntries} onDay={onDay} onNavigate={onNavigate} />}
    <div className="calendar-main">{view === "month" ? <MonthGrid days={days} selectedDay={selectedDay} today={today} entries={entries} onDay={onDay} onEvent={onEvent} /> : <TimeGrid days={days} today={today} now={now} entries={entries} onDay={onDay} onEvent={onEvent} />}
      {!entries.length && <p className="calendar-grid-empty"><CalendarDays size={16} aria-hidden="true" />No matching events in these dates.</p>}
    </div>
  </div>;
}
