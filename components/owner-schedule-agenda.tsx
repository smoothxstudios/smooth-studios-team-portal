"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { AlertTriangle, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, Plus, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OwnerScheduleCalendar } from "@/components/owner-schedule-calendar";
import type { TeamAssignment, TeamSchedule } from "@/lib/team-api";
import type { WorkEntry, AvailabilityEntry, ScheduleEntry as Entry, ScheduleView as View } from "@/lib/schedule-calendar-types";
import { TEAM, STUDIO_ZONE, addLocalDays, assignmentConflicts, hasConflictOverride, localInstant, overlaps, studioLocal } from "@/lib/team-schedule.mjs";
import { agendaMatchesStatus, agendaOnDay, buildScheduleAgenda } from "@/lib/schedule-agenda.mjs";
import { calendarDays, calendarMonth, moveCalendarMonth } from "@/lib/schedule-calendar.mjs";

type Status = "all" | "unassigned" | "pending" | "confirmed";
const statusOptions: { id: Status; label: string }[] = [{ id: "all", label: "All work" }, { id: "unassigned", label: "Unassigned" }, { id: "pending", label: "Pending" }, { id: "confirmed", label: "Confirmed" }];
const name = (id: string) => TEAM.find(person => person.id === id)?.name ?? id;
const time = (value: string) => new Date(value).toLocaleTimeString("en-US", { timeZone: STUDIO_ZONE, hour: "numeric", minute: "2-digit" });
const shortDate = (value: string) => new Date(value).toLocaleDateString("en-US", { timeZone: STUDIO_ZONE, month: "short", day: "numeric" });
const dayLabel = (day: string) => new Date(localInstant(`${day}T12:00`)).toLocaleDateString("en-US", { timeZone: STUDIO_ZONE, weekday: "long", month: "short", day: "numeric" });
function timeRange(item: { start: string; end: string }) {
  return `${time(item.start)}–${studioLocal(item.start).slice(0, 10) === studioLocal(item.end).slice(0, 10) ? "" : `${shortDate(item.end)} `}${time(item.end)}`;
}
function Person({ id }: { id: string }) {
  return <span className="schedule-person"><i style={{ background: TEAM.find(person => person.id === id)?.color }} />{name(id)}</span>;
}
function Confirmation({ person }: { person: WorkEntry["confirmations"][number] }) {
  const accepted = person.appStatus === "accepted" || (!person.appStatus && person.calendarAccepted);
  return <li className={`agenda-guest ${accepted ? "accepted" : "pending"}`}>
    <span className="agenda-guest-avatar" style={{ background: TEAM.find(member => member.id === person.employeeId)?.color }} aria-hidden="true">
      {name(person.employeeId).slice(0, 1)}<span className="agenda-guest-check">{accepted ? <Check size={12} strokeWidth={3} /> : <Clock3 size={12} strokeWidth={2.5} />}</span>
    </span>
    <span className="agenda-guest-copy"><strong>{name(person.employeeId)}</strong><span className="agenda-guest-response">{person.appStatus === "accepted" ? "Accepted in app" : person.appStatus === "pending" ? "Awaiting app response" : "Calendar accepted"}</span>
      {person.appStatus && person.calendarAccepted && <span className="agenda-guest-calendar"><Check size={12} aria-hidden="true" />Calendar accepted</span>}
    </span>
  </li>;
}

export function OwnerScheduleAgenda({ schedule, employeeId, onEmployeeChange, onAssign, onAvailability, onRefresh, busy, renderAssignment, onChecklist }: {
  schedule: TeamSchedule; employeeId: string; onEmployeeChange: (id: string) => void;
  onAssign: (appointmentId?: string) => void; onAvailability: () => void; onRefresh: () => void;
  onChecklist?: () => void; busy: boolean; renderAssignment: (item: TeamAssignment) => ReactNode;
}) {
  const [now, setNow] = useState(Date.now);
  const [selectedDay, setSelectedDay] = useState(() => studioLocal(now).slice(0, 10));
  const [view, setView] = useState<View>("month");
  const [status, setStatus] = useState<Status>("all");
  const [query, setQuery] = useState("");
  const [showAvailability, setShowAvailability] = useState(false);
  const [focused, setFocused] = useState<{ id: string; day: string } | null>(null);
  useEffect(() => {
    const updateClock = () => setNow(Date.now());
    const timer = window.setInterval(updateClock, 60_000);
    window.addEventListener("focus", updateClock);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", updateClock); };
  }, []);
  const today = studioLocal(now).slice(0, 10);
  const displayDays = calendarDays(selectedDay, view) as string[];
  const rangeStart = displayDays[0];
  const rangeEnd = addLocalDays(`${displayDays[displayDays.length - 1]}T00:00`, 1).slice(0, 10);
  const entries = useMemo(() => {
    const days = view === "list" ? calendarDays(selectedDay, "list") : calendarMonth(selectedDay);
    const from = localInstant(`${days[0]}T00:00`);
    const to = localInstant(addLocalDays(`${days[days.length - 1]}T00:00`, 1));
    return buildScheduleAgenda(schedule, { from, to, employeeId, query }) as Entry[];
  }, [schedule, employeeId, query, selectedDay, view]);
  const rangeEntries = entries.filter(item => overlaps(item, { start: localInstant(`${rangeStart}T00:00`), end: localInstant(`${rangeEnd}T00:00`) }));
  const counts = Object.fromEntries(statusOptions.map(option => [option.id, rangeEntries.filter(item => agendaMatchesStatus(item, option.id, employeeId)).length])) as Record<Status, number>;
  const work = rangeEntries.filter((item): item is WorkEntry => item.kind === "work" && agendaMatchesStatus(item, status, employeeId));
  const availability = rangeEntries.filter((item): item is AvailabilityEntry => item.kind !== "work");
  const calendarEntries = [...work, ...(showAvailability && status === "all" ? availability : [])];
  const monthEntries = entries.filter(item => item.kind === "work" ? agendaMatchesStatus(item, status, employeeId) : showAvailability && status === "all");
  const focusedItem = focused ? entries.find(item => item.id === focused.id) : null;
  const hasFilters = Boolean(query || employeeId !== "all" || status !== "all");
  const history = schedule.assignments.filter(item => (employeeId === "all" || item.employeeId === employeeId) &&
    (!["pending", "accepted"].includes(item.status) || Date.parse(item.end) <= now))
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  function clearFilters() { setQuery(""); setStatus("all"); onEmployeeChange("all"); }
  function moveDate(direction: number) {
    setSelectedDay(view === "month" ? moveCalendarMonth(selectedDay, direction) : addLocalDays(`${selectedDay}T00:00`, direction * (view === "week" ? 7 : view === "list" ? 30 : 1)).slice(0, 10));
  }
  function selectDay(day: string) { setSelectedDay(day); setView("day"); }
  function assign(appointmentId?: string) { setFocused(null); onAssign(appointmentId); }

  function workCard(item: WorkEntry, day: string, expanded = false) {
    const live = item.assignments.filter(offer => ["pending", "accepted"].includes(offer.status));
    const previous = item.assignments.filter(offer => !["pending", "accepted"].includes(offer.status));
    const conflicts = live.filter(offer => !hasConflictOverride(offer) && assignmentConflicts(offer.employeeId, offer, schedule.blocks, schedule.assignments, schedule.appointments, offer.id).length);
    const eventColor = item.employeeIds.length === 1 ? TEAM.find(person => person.id === item.employeeIds[0])?.color : "#4285f4";
    return <article className={`agenda-work ${item.status}`} style={{ "--agenda-event-color": eventColor ?? "#4285f4" } as CSSProperties} key={item.id}>
      <div className="agenda-work-heading">
        <div className="agenda-time"><Clock3 size={15} aria-hidden="true" /><span>{studioLocal(item.start).slice(0, 10) < day && <small>From {shortDate(item.start)} · </small>}{timeRange(item)}</span></div>
        <span className={`agenda-status ${item.status}`}>{item.status === "unassigned" ? "Unassigned" : item.status === "pending" ? "Pending response" : <><Check size={14} aria-hidden="true" />Confirmed</>}</span>
      </div>
      <div className="agenda-work-title"><h4>{item.customer || item.title}</h4>{item.customer && <p>{item.title}</p>}{!item.appointment && <small>Assignment</small>}</div>
      <div className="agenda-staff">
        {item.confirmations.length > 0 && <ul className="agenda-guests" aria-label="Employee confirmations">{item.confirmations.map(person => <Confirmation person={person} key={person.employeeId} />)}</ul>}
        {conflicts.length > 0 && <div className="agenda-conflict"><AlertTriangle size={15} aria-hidden="true" />Time conflict · {conflicts.map(offer => name(offer.employeeId)).join(", ")}</div>}
      </div>
      <div className="agenda-work-actions">
        {onChecklist && item.appointment && /studio.*rental|rental.*studio/i.test(item.title) && <Button variant="outline" onClick={() => { setFocused(null); onChecklist(); }}>Rental checklist</Button>}
        {item.appointment && Date.parse(item.start) > now && <Button disabled={busy} variant={item.status === "unassigned" ? "default" : "outline"} onClick={() => assign(item.appointment!.id)}><Plus size={15} />{item.status === "unassigned" ? "Assign person" : "Add person"}</Button>}
        <details className="agenda-details" open={expanded || undefined}>
          <summary>Details{live.length > 0 ? ` & offers (${live.length})` : ""}<ChevronDown size={16} aria-hidden="true" /></summary>
          <div>
            <p className="schedule-small">{dayLabel(studioLocal(item.start).slice(0, 10))} · {timeRange(item)} Eastern</p>
            {item.appointment && <p className="schedule-small">Appointment price: {(item.appointment.priceCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}</p>}
            {live.length ? <div className="agenda-offer-details">{live.map(renderAssignment)}</div> : <p className="schedule-small">{item.calendarIds.length ? "Staff confirmed through Google Calendar." : "No active offers. Choose Assign person to send one."}</p>}
            {previous.length > 0 && <div className="agenda-previous"><strong>Previous offers</strong>{previous.map(offer => <p key={offer.id}>{name(offer.employeeId)} · {offer.status}</p>)}</div>}
          </div>
        </details>
      </div>
    </article>;
  }

  return <div className="owner-agenda">
    <div className="agenda-heading"><div><h2>Your team’s schedule</h2><p>Bookings, tasks, and who’s covering them.</p></div><div className="schedule-actions"><Button onClick={() => onAssign()} disabled={busy}><Plus size={16} />Assign work</Button><Button onClick={onAvailability} variant="outline"><CalendarDays size={16} />Availability</Button></div></div>
    <section className="schedule-panel agenda-panel" aria-label="Team calendar">
      <div className="agenda-controls">
        <div className="agenda-search-row"><label className="agenda-search"><Search size={17} aria-hidden="true" /><Input aria-label="Search schedule" placeholder="Find a client, booking, or teammate" type="search" value={query} onChange={event => setQuery(event.target.value)} /></label><label className="agenda-person-filter"><span className="sr-only">Team member</span><select aria-label="Team member" value={employeeId} onChange={event => onEmployeeChange(event.target.value)}><option value="all">Everyone</option>{TEAM.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label></div>
        <div className="agenda-period-row"><div className="agenda-view-switch" role="group" aria-label="Calendar view">{([{ id: "month", label: "Month" }, { id: "week", label: "Week" }, { id: "day", label: "Day" }, { id: "list", label: "List" }] as const).map(option => <button key={option.id} type="button" aria-pressed={view === option.id} onClick={() => setView(option.id)}>{option.label}</button>)}</div><label className="agenda-date-picker"><span>Jump to date</span><input aria-label="Jump to date" type="date" value={selectedDay} onChange={event => { if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) setSelectedDay(event.target.value); }} /></label></div>
        <div className="agenda-date-heading"><div><h3>{new Date(localInstant(`${selectedDay}T12:00`)).toLocaleDateString("en-US", { timeZone: STUDIO_ZONE, month: "long", year: "numeric" })}</h3><small>Eastern time · {view === "list" ? "Next 30 days" : "Tap an event for details"}</small></div><div className="schedule-actions"><Button size="icon" variant="outline" aria-label={`Previous ${view === "list" ? "30 days" : view}`} onClick={() => moveDate(-1)}><ChevronLeft size={18} /></Button><Button variant="outline" onClick={() => setSelectedDay(today)}>Today</Button><Button size="icon" variant="outline" aria-label={`Next ${view === "list" ? "30 days" : view}`} onClick={() => moveDate(1)}><ChevronRight size={18} /></Button></div></div>
        <div className="agenda-status-filters" role="group" aria-label="Filter staffing status">{statusOptions.map(option => <button type="button" key={option.id} className={option.id} aria-pressed={status === option.id} onClick={() => setStatus(option.id)}>{option.label}<span>{counts[option.id]}</span></button>)}</div>
        {view !== "list" && <label className="calendar-availability-toggle"><input type="checkbox" checked={showAvailability} onChange={event => setShowAvailability(event.target.checked)} disabled={status !== "all"} />Show availability{status !== "all" && <small>Choose All work to include time blocks</small>}</label>}
      </div>
      <div className="agenda-results-heading"><p role="status">{work.length} {work.length === 1 ? "booking or task" : "bookings & tasks"} · {view === "day" ? dayLabel(selectedDay) : `${shortDate(localInstant(`${rangeStart}T12:00`))}–${shortDate(localInstant(addLocalDays(`${rangeEnd}T12:00`, -1)))}`}</p>{hasFilters && <button type="button" onClick={clearFilters}><X size={14} />Clear filters</button>}</div>
      {view !== "list" ? <OwnerScheduleCalendar selectedDay={selectedDay} view={view} days={displayDays} today={today} now={now} entries={calendarEntries} monthEntries={monthEntries} onDay={selectDay} onNavigate={setSelectedDay} onEvent={(item, day) => setFocused({ id: item.id, day })} /> : <div className="agenda-results">
        {!work.length && <div className="agenda-empty"><CalendarDays size={26} aria-hidden="true" /><h4>{hasFilters ? "No matching work in this range" : "No bookings or tasks in this range"}</h4><p>{hasFilters ? "Clear a filter, try another name, or choose another month." : "Choose another date or open the calendar."}</p><Button variant="outline" onClick={() => setView("month")}>Open calendar</Button></div>}
        {displayDays.map(day => {
          const dayWork = agendaOnDay(work, day) as WorkEntry[];
          const dayAvailability = agendaOnDay(availability, day) as AvailabilityEntry[];
          if (!dayWork.length && (!dayAvailability.length || status !== "all")) return null;
          const blocked = dayAvailability.filter(item => item.kind === "block");
          const preferred = dayAvailability.filter(item => item.kind === "preference");
          return <section className="agenda-day-group has-date" aria-label={dayLabel(day)} key={day}>
            <h3 className={`agenda-day-label${day === today ? " is-today" : ""}`} aria-label={`${day === today ? "Today, " : ""}${dayLabel(day)}`}><span aria-hidden="true">{new Date(`${day}T12:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" })}</span><strong aria-hidden="true">{Number(day.slice(-2))}</strong><small aria-hidden="true">{new Date(`${day}T12:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short" })}</small></h3>
            <div className="agenda-day-content">
            {dayWork.map(item => workCard(item, day))}
            {status === "all" && dayAvailability.length > 0 && <details className="agenda-availability"><summary><CalendarDays size={17} aria-hidden="true" /><span>Team availability <small>{blocked.length} blocked · {preferred.length} prefer to work</small></span><ChevronDown size={16} aria-hidden="true" /></summary><div>{dayAvailability.map(item => <div className={`agenda-availability-entry ${item.kind}`} key={item.id}><Person id={item.userId} /><strong>{item.kind === "block" ? item.title : "Wants to work"}</strong><span>{item.allDay ? "Full day" : `${shortDate(item.start)} · ${timeRange(item)}`}{item.kind === "block" ? " · Blocked" : ""}</span>{item.note && <p>{item.note}</p>}</div>)}<Button variant="outline" onClick={onAvailability}>Manage availability</Button></div></details>}
            </div>
          </section>;
        })}
      </div>}
      <div className="agenda-sync"><span>{schedule.syncedAt ? `Calendar synced ${shortDate(schedule.syncedAt)} at ${time(schedule.syncedAt)} ET` : "Waiting for Calendar sync"}</span><Button variant="ghost" disabled={busy} onClick={onRefresh}><RefreshCw size={15} />Refresh</Button></div>
    </section>
    <Dialog open={Boolean(focusedItem)} onOpenChange={open => { if (!open) setFocused(null); }}><DialogContent className="calendar-event-dialog"><DialogHeader><DialogTitle>{focusedItem?.kind === "work" ? "Booking & team" : "Team availability"}</DialogTitle><DialogDescription>{focused ? dayLabel(focused.day) : ""} · Eastern time</DialogDescription></DialogHeader>
      {focusedItem?.kind === "work" ? workCard(focusedItem, focused!.day, true) : focusedItem && <div className="calendar-availability-detail"><Person id={focusedItem.userId} /><h3>{focusedItem.title}</h3><p>{focusedItem.allDay ? "Full day" : timeRange(focusedItem)}</p>{focusedItem.note && <p>{focusedItem.note}</p>}<Button variant="outline" onClick={() => { setFocused(null); onAvailability(); }}>Manage availability</Button></div>}
    </DialogContent></Dialog>
    {history.length > 0 && <details className="schedule-panel agenda-history"><summary><span>Past offers & responses <small>{history.length}</small></span><ChevronDown size={17} aria-hidden="true" /></summary><div>{history.slice(0, 50).map(item => <div key={item.id}><Person id={item.employeeId} /><strong>{item.title}</strong><span>{shortDate(item.start)} · {time(item.start)}</span><span className={`schedule-status ${item.status}`}>{item.status === "pending" ? "No response" : item.status}</span></div>)}{history.length > 50 && <p className="schedule-small">Showing the latest 50 responses.</p>}</div></details>}
    <details className="agenda-help"><summary>Calendar & assignment details</summary><p>Assign work here. A green check with “Accepted in app” means the employee accepted that offer. An amber clock means their app response is still pending. “Calendar accepted” shows a separate Google Calendar RSVP; receiving a notification does not confirm an assignment.</p><p>For studio rentals, open the Google Calendar event to see the same app response at the top of its description after the next sync. Syncing is scheduled every 5 minutes and can be delayed. This is a backup copy of the app response; Google’s guest RSVP check stays separate. Custom tasks stay here.</p><p>Times are Eastern. To reassign a booking, open Details, cancel the existing offer, then add the new person.</p></details>
  </div>;
}
