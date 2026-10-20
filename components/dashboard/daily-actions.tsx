"use client";
import type { ReactNode } from "react";
import { ArrowRight, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PersonLabel } from "./person-label";
import { ownerDailyWork, creativeNextActions } from "@/lib/daily-actions.mjs";
import { formatDate, formatTime } from "@/lib/dashboard-presentation";
import type { TeamSchedule } from "@/lib/team-api";
import type { WorkEntry } from "@/lib/schedule-calendar-types";
import type { CreativeAssignment, CreativeWorkState } from "@/lib/use-creative-work";

export function OwnerDailyActions({ schedule, loading, onOpen, onSchedule }: { schedule: TeamSchedule | null; loading: boolean; onOpen: (item: WorkEntry) => void; onSchedule: () => void }) {
  const work = schedule ? ownerDailyWork(schedule) : { today: [], pending: [], unassigned: [] };
  const futurePending = work.pending.filter((item: WorkEntry) => !work.today.some((today: WorkEntry) => today.id === item.id));
  const row = (item: WorkEntry, next: string) => <button className="daily-action-row" key={item.id} onClick={() => onOpen(item)}><span className="daily-action-time">{formatTime(item.start)}<small>{formatDate(item.start, true)}</small></span><span className="daily-action-copy"><strong>{item.customer || item.title}</strong>{item.customer && <small>{item.title}</small>}<span className="daily-people">{item.employeeIds.map(id => <PersonLabel key={id} id={id} />)}</span><span className="daily-next-step">{next}</span></span><ChevronRight size={18} /></button>;
  return <article className="panel daily-action-list"><div className="panel-heading"><h2>Today’s action list</h2><Button variant="ghost" onClick={onSchedule}>Schedule<ArrowRight size={16} /></Button></div>
    {loading && !schedule ? <p role="status">Checking today’s work…</p> : !schedule ? <p>Today’s work couldn’t load. Use Try again above.</p> : <>
      <section><h3>Today <span>{work.today.length}</span></h3>{work.today.length ? work.today.map((item: WorkEntry) => row(item, item.status === "unassigned" ? "Assign a person" : item.pendingIds.length ? "Review responses" : Date.parse(item.end) <= Date.now() ? "Review completed rental" : "Open rental & checklist")) : <p className="daily-empty">No rentals or assignments today.</p>}</section>
      <section><h3>Upcoming responses <span>{futurePending.length}</span></h3>{futurePending.slice(0, 4).map((item: WorkEntry) => row(item, "Review offer or send reminder"))}{!futurePending.length && <p className="daily-empty">{work.pending.length ? "Today’s pending responses are listed above." : "No pending rental responses."}</p>}{futurePending.length > 4 && <Button variant="ghost" onClick={onSchedule}>View all {work.pending.length} pending bookings</Button>}</section>
      {work.unassigned.some((item: WorkEntry) => !work.today.some((today: WorkEntry) => today.id === item.id)) && <section><h3>Upcoming work needing crew</h3>{work.unassigned.filter((item: WorkEntry) => !work.today.some((today: WorkEntry) => today.id === item.id)).slice(0, 3).map((item: WorkEntry) => row(item, "Assign a person"))}</section>}
    </>}
  </article>;
}

export function CreativeActionList({ state, isOwner, onOpen, children }: { state: CreativeWorkState; isOwner: boolean; onOpen: (id?: string) => void; children?: ReactNode }) {
  const items = creativeNextActions(state.items, isOwner) as CreativeAssignment[];
  if (!items.length && !children && !state.loading && !state.error) return null;
  return <article className="panel daily-action-list"><div className="panel-heading"><h2>{isOwner ? "Needs your decision" : "Work to do"}</h2><Button variant="ghost" onClick={() => onOpen()}>All work<ArrowRight size={16} /></Button></div>
    {state.loading && <p role="status">Checking work…</p>}{state.error && <p role="alert">Work couldn’t load. <button onClick={() => void state.refresh()}>Try again</button></p>}
    {items.slice(0, 5).map(item => <button className="daily-action-row" key={item.id} onClick={() => onOpen(item.id)}><span className="daily-action-copy"><strong>{item.title}</strong>{isOwner && <PersonLabel id={item.employeeId} />}<small>Due {formatDate(item.dueAt, true)} · {formatTime(item.dueAt)}</small><span className="daily-next-step">{isOwner ? item.status === "submitted" ? "Review submission" : "Awaiting acceptance · view assignment" : item.status === "offered" ? "Accept assignment" : item.status === "revision" ? "Review feedback & submit work" : "Submit work"}</span></span><ChevronRight size={18} /></button>)}
    {items.length > 5 && <Button variant="ghost" onClick={() => onOpen()}>View all {items.length} assignments</Button>}{children}
  </article>;
}
