"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRefreshSource } from "@/components/dashboard-refresh";
import { teamRequest, type TeamSchedule } from "@/lib/team-api";
import { weeklyTeamHours } from "@/lib/team-summary.mjs";
import { teamAccent } from "@/lib/dashboard-presentation";
import { localInstant } from "@/lib/team-schedule.mjs";
import type { Employee, Rental } from "@/lib/dashboard-types";

const weekDate = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" });

export function OwnerWeeklyHours({ employees, rentals, token }: { employees: Employee[]; rentals: Rental[]; token: string }) {
  const [schedule, setSchedule] = useState<TeamSchedule | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now);
  const [weekOffset, setWeekOffset] = useState(0);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++sequence.current;
    try { const next = await teamRequest<TeamSchedule>(token, "/schedule"); if (id === sequence.current) { setSchedule(next); setNow(Date.now()); setError(""); } return true; }
    catch { if (id === sequence.current) setError("Live hours could not update. Showing the last available schedule."); return false; }
    finally { if (id === sequence.current) setLoading(false); }
  }, [token]);
  useRefreshSource(refresh);
  useEffect(() => { void refresh(); const update = () => { if (document.visibilityState === "visible") void refresh(); }; const timer = window.setInterval(update, 60_000); window.addEventListener("focus", update); return () => { sequence.current++; clearInterval(timer); window.removeEventListener("focus", update); }; }, [refresh]);
  const week = weeklyTeamHours(employees, rentals, schedule, now, weekOffset);
  return <section className="panel owner-weekly-hours"><div className="panel-heading"><div><h2>Team hours</h2><p aria-live="polite">{weekDate.format(new Date(week.from))}–{weekDate.format(new Date(localInstant(`${week.through}T12:00`)))}</p></div>
    <div className="team-hours-week-nav" role="group" aria-label="Choose team hours week">
      <button type="button" className="team-hours-week-button" aria-label="Previous week" onClick={() => setWeekOffset(value => value - 1)}><ChevronLeft size={18} aria-hidden="true" /></button>
      {weekOffset < 0 && <button type="button" className="team-hours-week-button" onClick={() => setWeekOffset(0)}>This week</button>}
      <button type="button" className="team-hours-week-button" aria-label="Next week" disabled={weekOffset === 0} onClick={() => setWeekOffset(value => Math.min(0, value + 1))}><ChevronRight size={18} aria-hidden="true" /></button>
    </div></div>
    <div className="team-hours-body">{loading && <p className="schedule-small" role="status">Updating hours…</p>}{error && <p className="schedule-warning" role="status">{error}</p>}
    <div className="team-hours-grid">{week.people.map(person => <div key={person.id} className="team-hours-person"><span className="employee-avatar" style={{ background: teamAccent(person.id, person.accent) }}>{person.name.slice(0, 1)}</span><strong>{person.name}</strong><span>{person.hours.toLocaleString("en-US", { maximumFractionDigits: 2 })} <small>hrs</small></span></div>)}</div>
    <p className="schedule-small">Monday–Sunday · Based on completed, accepted work in the available schedule history. Overlapping time counts once.</p></div>
  </section>;
}
