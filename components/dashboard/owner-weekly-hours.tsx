"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRefreshSource } from "@/components/dashboard-refresh";
import { teamRequest, type TeamSchedule } from "@/lib/team-api";
import { weeklyTeamHours } from "@/lib/team-summary.mjs";
import { teamAccent, formatDate } from "@/lib/dashboard-presentation";
import { localInstant } from "@/lib/team-schedule.mjs";
import type { Employee, Rental } from "@/lib/dashboard-types";

export function OwnerWeeklyHours({ employees, rentals, token }: { employees: Employee[]; rentals: Rental[]; token: string }) {
  const [schedule, setSchedule] = useState<TeamSchedule | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++sequence.current;
    try { const next = await teamRequest<TeamSchedule>(token, "/schedule"); if (id === sequence.current) { setSchedule(next); setNow(Date.now()); setError(""); } return true; }
    catch { if (id === sequence.current) setError("Live hours could not update. Showing the last available schedule."); return false; }
    finally { if (id === sequence.current) setLoading(false); }
  }, [token]);
  useRefreshSource(refresh);
  useEffect(() => { void refresh(); const update = () => { if (document.visibilityState === "visible") void refresh(); }; const timer = window.setInterval(update, 60_000); window.addEventListener("focus", update); return () => { sequence.current++; clearInterval(timer); window.removeEventListener("focus", update); }; }, [refresh]);
  const week = weeklyTeamHours(employees, rentals, schedule, now);
  return <section className="panel owner-weekly-hours"><div className="panel-heading"><div><h2>Team hours this week</h2><p>{formatDate(week.from, true)}–{formatDate(localInstant(`${week.through}T12:00`), true)} · Completed scheduled hours</p></div></div>
    {loading && <p className="schedule-small" role="status">Updating hours…</p>}{error && <p className="schedule-warning" role="status">{error}</p>}
    <div className="team-hours-grid">{week.people.map(person => <div key={person.id} className="team-hours-person"><span className="employee-avatar" style={{ background: teamAccent(person.id, person.accent) }}>{person.name.slice(0, 1)}</span><strong>{person.name}</strong><span>{person.hours.toLocaleString("en-US", { maximumFractionDigits: 2 })} <small>hrs</small></span></div>)}</div>
    <p className="schedule-small">Monday–Sunday · Accepted appointments and tasks that have ended. Overlapping time counts once.</p>
  </section>;
}
