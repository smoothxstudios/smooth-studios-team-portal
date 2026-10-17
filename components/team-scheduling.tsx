"use client";
import { RentalDescription } from "@/components/rental-description";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bell, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Plus, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { teamPushIsEnabled, teamRequest, type TeamSchedule, type TeamAssignment, type TimeBlock, type WorkPreference } from "@/lib/team-api";
import type { DashboardPayload } from "@/lib/dashboard-types";
import { EmployeeHome, type EmployeeHomeOptions } from "@/components/employee-home";
import { TeamAvailability } from "@/components/team-availability";
import { OwnerScheduleAgenda } from "@/components/owner-schedule-agenda";
import { useRefreshSource } from "@/components/dashboard-refresh";
import { saveScheduleMutation, scheduleMutationMessage, scheduleMutationError } from "@/lib/team-schedule-mutations.mjs";
import { TEAM, STUDIO_ZONE, studioLocal, localInstant, addLocalDays, blockOccurrences, assignmentConflicts, hasConflictOverride, overlaps, workPreferenceMatch } from "@/lib/team-schedule.mjs";
import { calendarInvitationStatus, calendarInvitationLabel, pendingCalendarInvitations } from "@/lib/calendar-invitations.mjs";
import { CalendarAssignmentStatus } from "@/components/calendar-assignment-status";

const personName = (id: string) => TEAM.find(p => p.id === id)?.name ?? id;
const time = (value: string) => new Date(value).toLocaleTimeString("en-US", { timeZone: STUDIO_ZONE, hour: "numeric", minute: "2-digit" });
const date = (value: string) => new Date(value).toLocaleDateString("en-US", { timeZone: STUDIO_ZONE, month: "short", day: "numeric" });
const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const future = (value: string) => Date.parse(value) > Date.now();
const initialPeriod = () => {
  const day = addLocalDays(studioLocal(Date.now()), 1).slice(0, 10);
  return { startLocal: `${day}T09:00`, endLocal: `${day}T10:00` };
};
function Person({ id }: { id: string }) {
  return <span className="schedule-person"><i style={{ background: TEAM.find(p => p.id === id)?.color }} />{personName(id)}</span>;
}

export function TeamSchedulingPage({ userId, isOwner, token, onSetup, calendarSync, home, pastContent, availabilityOnly = false, onAvailability, onChecklist, focusId, onCloseFocus }: { focusId?: string; onCloseFocus?: () => void; userId: string; isOwner: boolean; token: string; onSetup?: () => void; calendarSync?: DashboardPayload["calendarAssignmentSync"]; home?: EmployeeHomeOptions; pastContent?: ReactNode; availabilityOnly?: boolean; onAvailability?: () => void; onChecklist?: () => void }) {
  const isHome = Boolean(home);
  const [schedule, setSchedule] = useState<TeamSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [scheduleTab, setScheduleTab] = useState<"upcoming" | "past">("upcoming");
  const requestVersion = useRef(0);
  const mutationInFlight = useRef(false);
  const reminderIds = useRef(new Map<string, string>());
  const [filter, setFilter] = useState(isOwner ? "all" : userId);
  const [week, setWeek] = useState(() => studioLocal(Date.now()).slice(0, 10));
  const [blockOpen, setBlockOpen] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ path: string; method: string; data: object; description: string } | null>(null);
  const [block, setBlock] = useState({ userId, reason: "", ...initialPeriod(), repeatUntil: "", weekly: false });
  const [assignment, setAssignment] = useState({ employeeId: "akiva", appointmentId: "", title: "", instructions: "", overrideConflicts: false, ...initialPeriod() });

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    const result = await teamRequest<TeamSchedule>(token, "/schedule");
    if (version === requestVersion.current) { setSchedule(result); setNeedsRefresh(false); }
  }, [token]);
  useEffect(() => {
    let disposed = false;
    async function refresh() {
      if (mutationInFlight.current) return;
      const version = ++requestVersion.current;
      try {
        const activation = await fetch("./data/team-api.json", { cache: "no-store" });
        const ready = activation.ok && (await activation.json()).enabled === true;
        if (disposed) return;
        setEnabled(ready);
        if (ready) {
          const result = await teamRequest<TeamSchedule>(token, "/schedule");
          if (!disposed && version === requestVersion.current) { setSchedule(result); setError(""); setNeedsRefresh(false); }
          // Keep already-enabled devices current without showing controls here.
          if (!availabilityOnly) {
            try { await teamPushIsEnabled(token, result.pushPublicKey); } catch { /* Settings handles setup feedback. */ }
          }
        }
      } catch { if (!disposed && version === requestVersion.current) setError("Couldn’t refresh scheduling. Check your connection and try again; the last view may be out of date."); }
      finally { if (!disposed) setLoading(false); }
    }
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 60_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [token, isHome, availabilityOnly, isOwner]);

  async function mutate(path: string, data: object, method = "POST") {
    if (!schedule || busy || needsRefresh || mutationInFlight.current) return false;
    mutationInFlight.current = true;
    ++requestVersion.current;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await saveScheduleMutation({
        path, method, data, revision: schedule.revision, userId, isOwner,
        write: (revision: number) => teamRequest<{ notification?: string }>(token, path, { ...data, revision }, method),
        refresh: () => teamRequest<TeamSchedule>(token, "/schedule"),
        onRefresh: (fresh: TeamSchedule) => { setSchedule(fresh); setNeedsRefresh(false); },
      });
      setNeedsRefresh(true);
      // Reflect a confirmed response immediately, even if the follow-up read fails.
      if (path.startsWith("/assignments/") && "status" in data && ["accepted", "declined", "cancelled"].includes(String(data.status))) {
        setSchedule(current => current ? { ...current, assignments: current.assignments.map(a => a.id === path.slice(13) ? { ...a, status: data.status as TeamAssignment["status"] } : a) } : current);
      }
      // Once saved, a refresh failure must not invite a duplicate submission.
      setMessage(scheduleMutationMessage(path, data, method, result));
      try { await load(); } catch { setError("Your change was saved, but the updated view could not load. Try again to load the latest view before making another change."); }
      return true;
    } catch (e) { setError(scheduleMutationError(path, e)); return false; }
    finally { mutationInFlight.current = false; setBusy(false); }
  }

  async function remindAssignment(item: TeamAssignment) {
    if (!isOwner || busy || mutationInFlight.current) return;
    mutationInFlight.current = true; setBusy(true); setError(""); setMessage("");
    const id = reminderIds.current.get(item.id) ?? crypto.randomUUID();
    reminderIds.current.set(item.id, id);
    try {
      const result = await teamRequest<{ notification: string }>(token, `/assignments/${item.id}/remind`, { id });
      reminderIds.current.delete(item.id);
      setMessage(result.notification);
    } catch (error) {
      setError(error instanceof Error ? error.message : "The reminder could not be confirmed. Try again.");
      try { await load(); } catch { /* Keep the last schedule while preserving the retry ID. */ }
    } finally { mutationInFlight.current = false; setBusy(false); }
  }

  const appointments = useMemo(() => (schedule?.appointments ?? []).filter(a => future(a.start)).sort((a, b) => Date.parse(a.start) - Date.parse(b.start)), [schedule]);
  const selectedAppointment = appointments.find(a => a.id === assignment.appointmentId);
  let period: { start: string; end: string; appointmentId?: string } | null = null;
  try { period = selectedAppointment ? { ...selectedAppointment, appointmentId: selectedAppointment.id } : { start: localInstant(assignment.startLocal), end: localInstant(assignment.endLocal) }; } catch { /* Field validation below. */ }
  const conflicts = period && schedule ? assignmentConflicts(assignment.employeeId, period, schedule.blocks, schedule.assignments, schedule.appointments) : [];
  const alreadyInvited = selectedAppointment?.acceptedEmployeeIds.includes(assignment.employeeId);
  const alreadyOffered = Boolean(selectedAppointment && schedule?.assignments.some(a => a.appointmentId === selectedAppointment.id && a.employeeId === assignment.employeeId && ["pending", "accepted"].includes(a.status)));
  const visibleAssignments = (schedule?.assignments ?? []).filter(a => (filter === "all" || a.employeeId === filter)).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const upcomingAssignments = visibleAssignments.filter(a => future(a.end) && ["pending", "accepted"].includes(a.status));
  const blocks = (schedule?.blocks ?? []).filter(b => filter === "all" || b.userId === filter).sort((a, b) => a.startLocal.localeCompare(b.startLocal));
  const preferences = (schedule?.workPreferences ?? []).filter(p => filter === "all" || p.userId === filter);
  const selectedPreference = period ? workPreferenceMatch(assignment.employeeId, period, schedule?.workPreferences ?? []) : "none";
  function employeeAvailabilityLabel(id: string) {
    if (!period || !schedule) return "";
    if (assignmentConflicts(id, period, schedule.blocks, schedule.assignments, schedule.appointments).length) return "Time conflict";
    if (!schedule.availabilityVersion) return "No recorded conflict";
    const match = workPreferenceMatch(id, period, schedule.workPreferences ?? []);
    return match === "full" ? "Wants to work this time" : match === "partial" ? "Partly within preferred hours" : "No preference recorded";
  }
  const days = Array.from({ length: 7 }, (_, i) => addLocalDays(`${week}T00:00`, i).slice(0, 10));
  function openAssignment(appointmentId = "") {
    setAssignment({ employeeId: filter !== "all" && filter !== "owner" ? filter : "akiva", appointmentId, title: "", instructions: "", overrideConflicts: false, ...initialPeriod() });
    setError(""); setAssignmentOpen(true);
  }
  function openBlockTime(id?: string) {
    setError(""); setBlock({ userId: isOwner ? id ?? (filter !== "all" ? filter : userId) : userId, reason: "", ...initialPeriod(), repeatUntil: "", weekly: false }); setBlockOpen(true);
  }
  async function refreshManually() {
    if (mutationInFlight.current || busy) return false;
    setBusy(true); setError("");
    try { await load(); setEnabled(true); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "Refresh failed."); return false; }
    finally { setBusy(false); }
  }
  useRefreshSource(refreshManually);
  function assignmentCard(item: TeamAssignment) {
    const appointment = schedule?.appointments.find(a => a.id === item.appointmentId);
    const busyConflicts = schedule ? assignmentConflicts(item.employeeId, item, schedule.blocks, schedule.assignments, schedule.appointments, item.id) : [];
    const conflictApproved = hasConflictOverride(item);
    return <article className="schedule-offer" key={item.id}>
      <div className="schedule-row">{!home && <Person id={item.employeeId} />}<span className={`schedule-status ${item.status}`}>{item.status === "pending" && !future(item.start) ? "Needs Smooth’s review" : home ? "Awaiting your response" : item.status}</span></div>
      <h3>{appointment?.title ?? item.title}</h3>
      {appointment?.customer && <p>{appointment.customer}</p>}
      <p><CalendarDays size={15} /> {date(item.start)} · {time(item.start)}–{time(item.end)}</p>
      {(!home || !item.appointmentId) && <p className="schedule-small">{item.appointmentId ? "Calendar appointment · rental earnings follow existing payment rules" : "Custom assignment · confirm pay with Smooth"}</p>}
      {appointment && /studio.*rental|rental.*studio/i.test(appointment.title) && <RentalDescription details={appointment.rentalDetails} />}
      {item.instructions && <p className="schedule-instructions">{item.instructions}</p>}
      {item.note && <p className="schedule-notice">{item.note}</p>}
      <CalendarAssignmentStatus delivery={item.calendarSync} />
      {busyConflicts.length > 0 && <p className="schedule-warning">Conflict: {busyConflicts.join("; ")}. {conflictApproved ? "Smooth approved this time conflict. You can still accept the offer." : isOwner ? "You can approve this time conflict below." : "Ask Smooth to approve the conflict or adjust the assignment."}</p>}
      {conflictApproved && <p className="schedule-small">Time conflict override approved by Smooth for this appointment time.</p>}
      <div className="schedule-actions">
        {isOwner && item.status === "pending" && future(item.start) && <Button disabled={busy || needsRefresh} variant="outline" onClick={() => void remindAssignment(item)}><Bell size={16} />Remind</Button>}
        {onChecklist && item.appointmentId && item.status === "accepted" && /studio.*rental|rental.*studio/i.test(item.title) && <Button variant="outline" onClick={() => onChecklist()}>Rental checklist</Button>}
        {!isOwner && item.status === "pending" && future(item.start) && <>
          <Button disabled={busy || needsRefresh || (busyConflicts.length > 0 && !conflictApproved)} onClick={() => void mutate(`/assignments/${item.id}`, { status: "accepted" })}><Check size={16} />Accept</Button>
          <Button disabled={busy || needsRefresh} variant="outline" onClick={() => setConfirm({ path: `/assignments/${item.id}`, method: "POST", data: { status: "declined" }, description: `Decline ${item.title} on ${date(item.start)}? Smooth will see your response.` })}><X size={16} />Decline</Button>
        </>}
        {isOwner && ["pending", "accepted"].includes(item.status) && future(item.start) && busyConflicts.length > 0 && !conflictApproved && <Button disabled={busy || needsRefresh} variant="outline" onClick={() => setConfirm({ path: `/assignments/${item.id}`, method: "POST", data: { overrideConflicts: true }, description: `Allow ${personName(item.employeeId)} to accept ${item.title} despite the recorded conflicts for ${date(item.start)} at ${time(item.start)}? Their acceptance is still required. Changing the appointment time clears this approval.` })}>Allow time conflict</Button>}
        {isOwner && ["pending", "accepted"].includes(item.status) && future(item.start) && <Button disabled={busy || needsRefresh} variant="outline" onClick={() => setConfirm({ path: `/assignments/${item.id}`, method: "POST", data: { status: "cancelled" }, description: `Cancel ${personName(item.employeeId)}’s app offer for ${item.title}? The app will also remove an invitation it created. Invitations added separately in Google Calendar stay available.` })}>Cancel offer</Button>}
      </div>
    </article>;
  }

  const focusedItem = schedule?.assignments.find(item => item.id === focusId);
  return <section className="team-scheduling">
    {!home && (!isOwner || availabilityOnly || !schedule) && <header className="schedule-intro"><div>{isOwner && <p className="schedule-eyebrow">{availabilityOnly ? "TEAM AVAILABILITY" : "TEAM SCHEDULE"}</p>}<h2>{availabilityOnly ? isOwner ? "Availability" : "My availability" : isOwner ? "Schedule" : "My schedule"}</h2>{!isOwner && <p>{availabilityOnly ? "Add preferred work days or unavailable time." : "Review rental offers and assignments."}</p>}</div>
</header>}
    {error && <div role="alert" className="schedule-error"><p>{error}</p><Button disabled={busy} variant="outline" onClick={() => void refreshManually()}>Try again</Button></div>}
    {message && <p role="status" className="schedule-success">{message}</p>}
    {home && <EmployeeHome userId={userId} schedule={schedule} loading={loading} options={home} onBlockTime={() => openBlockTime()} renderOffer={assignmentCard} />}
    {!home && !availabilityOnly && !isOwner && <nav className="employee-schedule-tabs" aria-label="Schedule views"><Button variant={scheduleTab === "upcoming" ? "default" : "outline"} aria-pressed={scheduleTab === "upcoming"} onClick={() => setScheduleTab("upcoming")}>Upcoming</Button><Button variant={scheduleTab === "past" ? "default" : "outline"} aria-pressed={scheduleTab === "past"} onClick={() => setScheduleTab("past")}>Past</Button></nav>}
    {!home && !availabilityOnly && !isOwner && scheduleTab === "past" && <>{pastContent}<article className="schedule-panel"><h3>Past offers & responses</h3>{visibleAssignments.filter(a => !["pending", "accepted"].includes(a.status) || !future(a.end)).length ? <div className="schedule-history employee-past-offers">{visibleAssignments.filter(a => !["pending", "accepted"].includes(a.status) || !future(a.end)).slice(-50).reverse().map(a => <div key={a.id}><span>{date(a.start)} · {a.title}</span><span className="schedule-status">{a.status}</span></div>)}</div> : <p className="schedule-empty">{loading ? "Loading past offers…" : "No past offers in this view."}</p>}</article></>}
    {loading && !home && <div className="schedule-panel">Loading your schedule…</div>}
    {!loading && enabled === false && <div className="schedule-panel"><h3>Scheduling setup is waiting for deployment</h3><p>{isOwner ? "Your Cloudflare credentials are used securely by GitHub Actions. Activate below to deploy the Worker, prepare the database, and import Calendar. This area opens after all three succeed." : "Smooth is finishing setup. Your existing dashboard is unchanged."}</p>{isOwner && onSetup && <Button className="mt-4" onClick={onSetup}>Activate team scheduling</Button>}</div>}
    {schedule && !home && availabilityOnly && <TeamAvailability userId={userId} isOwner={isOwner} schedule={schedule} busy={busy} needsRefresh={needsRefresh} error={error} mutate={mutate} onBlockTime={openBlockTime} />}
    {schedule && !home && !availabilityOnly && (isOwner || scheduleTab === "upcoming") && <>
      {isOwner && calendarSync?.status === "needs_access" && <div className="schedule-warning" role="status"><strong>Google Calendar needs permission to show rental assignments</strong><p>In your rental calendar’s Settings and sharing, give <b>{calendarSync.serviceAccountEmail ?? "the existing dashboard service account"}</b> “Make changes to events” access. Rental team notes will appear after the next sync. Your assignments are saved here.</p></div>}
      {isOwner && calendarSync?.status === "retrying" && <p className="schedule-warning" role="status">Some rental team notes could not update in Google Calendar. They will retry on the next sync; your assignments are saved here.</p>}
      {isOwner ? <OwnerScheduleAgenda onChecklist={onChecklist} schedule={schedule} employeeId={filter} onEmployeeChange={setFilter} onAssign={openAssignment} onAvailability={onAvailability ?? (() => openBlockTime())} busy={busy} renderAssignment={assignmentCard} /> : <>
      <div className="schedule-toolbar"><div className="schedule-actions">
        <Button onClick={onAvailability ?? (() => openBlockTime())} variant="outline"><CalendarDays size={16} />Availability</Button>
        {isOwner && <Button onClick={() => openAssignment()} variant="outline"><Plus size={16} />Assign work</Button>}
      </div><label className="schedule-filter">{isOwner ? "View team member" : "Your schedule"}{isOwner ? <select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Everyone</option>{TEAM.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select> : <Person id={userId} />}</label></div>
      <div className="schedule-notice"><ShieldCheck size={18} /><p>Calendar and payment syncing is scheduled every 5 minutes; portal responses update immediately. {isOwner ? "Check recorded commitments before assigning work. Preferred days express interest; blocked time and existing work take priority. Employees confirm by accepting." : "A pending offer is confirmed when you select Accept."}</p></div>

      <article className="schedule-panel"><div className="schedule-row schedule-section-heading"><div><h3><CalendarDays size={20} />Week at a glance</h3><p>{date(localInstant(`${week}T12:00`))}–{date(localInstant(`${days[6]}T12:00`))} · {schedule.syncedAt ? `Calendar synced ${date(schedule.syncedAt)} at ${time(schedule.syncedAt)}` : "Waiting for Calendar"}</p></div><div className="schedule-actions">
        <Button size="icon" variant="outline" aria-label="Previous week" onClick={() => setWeek(addLocalDays(`${week}T00:00`, -7).slice(0, 10))}><ChevronLeft /></Button>
        <Button size="sm" variant="outline" onClick={() => setWeek(studioLocal(Date.now()).slice(0, 10))}>Today</Button>
        <Button size="icon" variant="outline" aria-label="Next week" onClick={() => setWeek(addLocalDays(`${week}T00:00`, 7).slice(0, 10))}><ChevronRight /></Button>
      </div></div>
      <div className="schedule-week">{days.map(day => {
        const from = localInstant(`${day}T00:00`), to = localInstant(addLocalDays(`${day}T00:00`, 1));
        const occurrences = blocks.flatMap(b => blockOccurrences(b, from, to)) as (TimeBlock & { start: string; end: string })[];
        const preferred = preferences.flatMap(p => blockOccurrences(p, from, to)) as (WorkPreference & { start: string; end: string })[];
        const offers = visibleAssignments.filter(a => ["pending", "accepted"].includes(a.status) && overlaps(a, { start: from, end: to }));
        const calendar = schedule.appointments.filter(a => overlaps(a, { start: from, end: to }) &&
          (filter === "all" || a.acceptedEmployeeIds.includes(filter) || ["needsAction", "tentative"].includes(calendarInvitationStatus(a, filter))));
        return <div className="schedule-day" key={day}><h4>{new Date(from).toLocaleDateString("en-US", { timeZone: STUDIO_ZONE, weekday: "short", day: "numeric", month: "short" })}</h4>
          {!occurrences.length && !preferred.length && !offers.length && !calendar.length && <p className="schedule-empty-day">No recorded commitments</p>}
          {preferred.map(p => <div className="schedule-entry preferred" key={`${p.id}-${p.start}`}><Person id={p.userId} /><strong>Wants to work</strong><span>{p.allDay ? "Full day" : `${time(p.start)}–${time(p.end)}`}</span>{p.note && <small>{p.note}</small>}</div>)}
          {occurrences.map(b => <div className="schedule-entry blocked" key={`${b.id}-${b.start}`}><Person id={b.userId} /><strong>{b.reason}</strong><span>{time(b.start)}–{time(b.end)} · Blocked</span></div>)}
          {calendar.map(a => <div className="schedule-entry" key={a.id}><strong>{a.customer ? `${a.customer} · ` : ""}{a.title}</strong><span>{time(a.start)}–{time(a.end)}</span><small className={a.acceptedEmployeeIds.length ? "schedule-calendar-accepted" : undefined}>{a.acceptedEmployeeIds.length ? <><Check size={14} aria-hidden="true" />Calendar accepted: {a.acceptedEmployeeIds.map(personName).join(", ")}</> : pendingCalendarInvitations(a).length ? "Respond in Google Calendar" : offers.some(o => o.appointmentId === a.id) ? "Portal offer below" : "No accepted team member"}</small>{pendingCalendarInvitations(a).map(invitation => <small key={invitation.employeeId}>{personName(invitation.employeeId)} · {calendarInvitationLabel(invitation.status)}</small>)}{/studio.*rental|rental.*studio/i.test(a.title) && <details className="rental-details-toggle"><summary>Rental details</summary><RentalDescription details={a.rentalDetails} /></details>}{isOwner && future(a.start) && <button onClick={() => openAssignment(a.id)}>Assign person →</button>}</div>)}
          {offers.map(a => <div className={`schedule-entry ${a.status}`} key={a.id}><Person id={a.employeeId} /><strong>{a.title}</strong><span>{time(a.start)}–{time(a.end)} · {a.status}</span></div>)}
        </div>;
      })}</div></article>

      <article className="schedule-panel"><div className="schedule-section-heading"><h3><Clock3 size={20} />Offers & assignments <span className="schedule-count">{upcomingAssignments.length}</span></h3><p>{isOwner ? "Offers remain pending until the employee responds. To reassign, cancel the old portal offer and create a new one." : "Accept only when you can cover the full time. Need a change after accepting? Contact Smooth."}</p></div>
        <div className="schedule-offers">{upcomingAssignments.length ? upcomingAssignments.map(assignmentCard) : <p className="schedule-empty">No upcoming portal assignments for this view.</p>}</div>
        {isOwner && visibleAssignments.some(a => !["pending", "accepted"].includes(a.status) || !future(a.end)) && <details className="schedule-history"><summary>Past offers & responses</summary>{visibleAssignments.filter(a => !["pending", "accepted"].includes(a.status) || !future(a.end)).slice(-50).reverse().map(a => <div key={a.id}><Person id={a.employeeId} /><span>{date(a.start)} · {a.title}</span><span>{a.status}</span></div>)}</details>}
      </article>


      <p className="schedule-small">Studio rental offers and acceptances are listed in the Google Calendar event’s description after syncing. Existing Calendar invitations remain valid. Custom tasks stay in this dashboard.</p>
      </>}
    </>}


    <Dialog open={blockOpen} onOpenChange={open => { if (!busy) setBlockOpen(open); }}><DialogContent className="schedule-modal"><DialogHeader><DialogTitle>Block time</DialogTitle><DialogDescription>Add the time you are unavailable. Existing assignments are not cancelled.</DialogDescription></DialogHeader>
      <form onSubmit={async e => { e.preventDefault(); if (await mutate("/blocks", { ...block, repeatUntil: block.weekly ? block.repeatUntil : null })) setBlockOpen(false); }}>
        {isOwner && <label>Team member<select value={block.userId} onChange={e => setBlock({ ...block, userId: e.target.value })}>{TEAM.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
        <label>Reason<Input required maxLength={120} value={block.reason} onChange={e => setBlock({ ...block, reason: e.target.value })} placeholder="Reason for being unavailable" /></label>
        <div className="schedule-form-pair"><label>Starts<Input required type="datetime-local" value={block.startLocal} onChange={e => setBlock({ ...block, startLocal: e.target.value })} /></label><label>Ends<Input required type="datetime-local" value={block.endLocal} onChange={e => setBlock({ ...block, endLocal: e.target.value })} /></label></div>
        <label className="schedule-check"><input type="checkbox" checked={block.weekly} onChange={e => setBlock({ ...block, weekly: e.target.checked })} />Repeat every week on this weekday</label>
        {block.weekly && <><p className="schedule-small">For a class that already started, use its original meeting date. The series must include an upcoming meeting.</p><label>Last date of the class or series<Input required type="date" min={block.startLocal.slice(0, 10)} max={addLocalDays(block.startLocal || `${week}T00:00`, 364).slice(0, 10)} value={block.repeatUntil} onChange={e => setBlock({ ...block, repeatUntil: e.target.value })} /></label></>}
        {error && <p className="schedule-error" role="alert">{error}</p>}
        <DialogFooter><Button disabled={busy} type="button" variant="outline" onClick={() => setBlockOpen(false)}>Cancel</Button><Button disabled={busy || needsRefresh} type="submit">{busy ? "Saving…" : "Save time block"}</Button></DialogFooter>
      </form></DialogContent></Dialog>

    <Dialog open={assignmentOpen} onOpenChange={open => { if (!busy) setAssignmentOpen(open); }}><DialogContent className="schedule-modal"><DialogHeader><DialogTitle>Assign work</DialogTitle><DialogDescription>Create an offer for one employee. They confirm by accepting it in their dashboard.</DialogDescription></DialogHeader>
      <form onSubmit={async e => { e.preventDefault(); if (await mutate("/assignments", assignment)) setAssignmentOpen(false); }}>
        <label>Rental or assignment<select value={assignment.appointmentId} onChange={e => setAssignment({ ...assignment, appointmentId: e.target.value, overrideConflicts: false })}><option value="">Custom assignment (no automatic commission)</option>{appointments.map(a => <option key={a.id} value={a.id}>{date(a.start)} {time(a.start)} · {a.customer} · {a.title}</option>)}</select></label>
        {selectedAppointment ? <p className="schedule-notice">{date(selectedAppointment.start)} · {time(selectedAppointment.start)}–{time(selectedAppointment.end)} · {money(selectedAppointment.priceCents)}<br />Calendar controls this rental’s date and price.</p> : <><label>Assignment title<Input required maxLength={160} value={assignment.title} onChange={e => setAssignment({ ...assignment, title: e.target.value })} placeholder="Prepare the studio, assist on location…" /></label><div className="schedule-form-pair"><label>Starts<Input required type="datetime-local" value={assignment.startLocal} onChange={e => setAssignment({ ...assignment, startLocal: e.target.value, overrideConflicts: false })} /></label><label>Ends<Input required type="datetime-local" value={assignment.endLocal} onChange={e => setAssignment({ ...assignment, endLocal: e.target.value, overrideConflicts: false })} /></label></div></>}
        <label>Employee<select value={assignment.employeeId} onChange={e => setAssignment({ ...assignment, employeeId: e.target.value, overrideConflicts: false })}>{TEAM.filter(p => p.id !== "owner").map(p => <option key={p.id} value={p.id}>{p.name}{period ? ` — ${employeeAvailabilityLabel(p.id)}` : ""}</option>)}</select></label>
        {period && schedule?.availabilityVersion === 1 && !conflicts.length && <p className={selectedPreference === "full" ? "schedule-success" : "schedule-notice"}>{selectedPreference === "full" ? `${personName(assignment.employeeId)} wants to work during this entire time. They still need to accept the offer.` : selectedPreference === "partial" ? "Only part of this assignment falls within their preferred hours. Confirm the full time with them." : "No work preference covers this time. You can still offer it; the employee confirms by accepting."}</p>}
        {(conflicts.length > 0 || alreadyInvited || alreadyOffered) && <p className="schedule-warning">{alreadyInvited ? "This person already accepted the Calendar invitation." : alreadyOffered ? "This person already has an active offer for this appointment." : conflicts.join("; ")}</p>}
        {isOwner && conflicts.length > 0 && !alreadyInvited && !alreadyOffered && <label className="schedule-check"><input type="checkbox" checked={assignment.overrideConflicts} onChange={e => setAssignment({ ...assignment, overrideConflicts: e.target.checked })} />Allow this time conflict. The employee still needs to accept.</label>}
        <label>Instructions (optional)<Textarea maxLength={2000} rows={3} value={assignment.instructions} onChange={e => setAssignment({ ...assignment, instructions: e.target.value })} placeholder="Arrival instructions, responsibilities, anything to prepare…" /></label>
        <p className="schedule-small">{schedule?.devices[assignment.employeeId] ? `${personName(assignment.employeeId)} has notifications enabled on ${schedule.devices[assignment.employeeId]} device(s). A push alert will be queued when you save.` : `${personName(assignment.employeeId)} has not enabled notifications on any device yet. They can still view and accept the offer in their dashboard.`}</p>
        {error && <p className="schedule-error" role="alert">{error}</p>}
        <DialogFooter><Button disabled={busy} type="button" variant="outline" onClick={() => setAssignmentOpen(false)}>Cancel</Button><Button disabled={busy || needsRefresh || (conflicts.length > 0 && !assignment.overrideConflicts) || alreadyInvited || alreadyOffered || !period} type="submit">{busy ? "Sending…" : "Send assignment offer"}</Button></DialogFooter>
      </form></DialogContent></Dialog>

    <Dialog open={Boolean(focusId)} onOpenChange={open => { if (!open && !busy) onCloseFocus?.(); }}><DialogContent className="schedule-modal"><DialogHeader><DialogTitle>Assignment details</DialogTitle><DialogDescription>Review the current assignment and its response.</DialogDescription></DialogHeader>
      {focusedItem ? assignmentCard(focusedItem) : <p role="status">{loading ? "Loading assignment…" : error || "This assignment is no longer available to this account."}</p>}
      {focusedItem && error && <p role="alert" className="schedule-error">{error}</p>}
      {message && <p role="status" className="schedule-success">{message}</p>}
    </DialogContent></Dialog>

    <Dialog open={Boolean(confirm)} onOpenChange={open => { if (!open && !busy) setConfirm(null); }}><DialogContent className="schedule-modal"><DialogHeader><DialogTitle>Confirm change</DialogTitle><DialogDescription>{confirm?.description}</DialogDescription></DialogHeader>{error && <p className="schedule-error" role="alert">{error}</p>}<DialogFooter><Button disabled={busy} variant="outline" onClick={() => setConfirm(null)}>Go back</Button><Button disabled={busy || needsRefresh} onClick={async () => { if (confirm && await mutate(confirm.path, confirm.data, confirm.method)) setConfirm(null); }}>Confirm</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
