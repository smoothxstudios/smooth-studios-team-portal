"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Plus, RefreshCw, ShieldCheck, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { enableTeamPush, disableTeamPush, teamRequest, type TeamSchedule, type TeamAssignment, type TimeBlock } from "@/lib/team-api";
import type { DashboardPayload } from "@/lib/dashboard-types";
import { TEAM, STUDIO_ZONE, studioLocal, localInstant, addLocalDays, blockOccurrences, assignmentConflicts, hasConflictOverride, overlaps } from "@/lib/team-schedule.mjs";

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

export function TeamSchedulingPage({ userId, isOwner, token, onSetup, calendarSync }: { userId: string; isOwner: boolean; token: string; onSetup?: () => void; calendarSync?: DashboardPayload["calendarAssignmentSync"] }) {
  const [schedule, setSchedule] = useState<TeamSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState(isOwner ? "all" : userId);
  const [week, setWeek] = useState(() => studioLocal(Date.now()).slice(0, 10));
  const [blockOpen, setBlockOpen] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ path: string; method: string; data: object; description: string } | null>(null);
  const [block, setBlock] = useState({ userId, reason: "Class", ...initialPeriod(), repeatUntil: "", weekly: false });
  const [assignment, setAssignment] = useState({ employeeId: "akiva", appointmentId: "", title: "", instructions: "", overrideConflicts: false, ...initialPeriod() });
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);

  const load = useCallback(async () => {
    const result = await teamRequest<TeamSchedule>(token, "/schedule");
    setSchedule(result);
  }, [token]);
  useEffect(() => {
    let disposed = false;
    async function refresh() {
      try {
        setPushSupported("serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
        const activation = await fetch("./data/team-api.json", { cache: "no-store" });
        const ready = activation.ok && (await activation.json()).enabled === true;
        if (disposed) return;
        setEnabled(ready);
        if (ready) {
          const result = await teamRequest<TeamSchedule>(token, "/schedule");
          if (!disposed) { setSchedule(result); setError(""); }
        }
      } catch { if (!disposed) setError("Couldn’t refresh scheduling. Check your connection and try Refresh; the last view may be out of date."); }
      finally { if (!disposed) setLoading(false); }
    }
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 60_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    if ("serviceWorker" in navigator) navigator.serviceWorker.getRegistration(new URL("./", window.location.href).href)
      .then(r => r?.pushManager.getSubscription()).then(s => { if (!disposed) setPushEnabled(Boolean(s)); }).catch(() => {});
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [token]);

  async function mutate(path: string, data: object, method = "POST") {
    if (!schedule || busy) return false;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await teamRequest<{ notification?: string }>(token, path, { ...data, revision: schedule.revision }, method);
      // Once saved, a refresh failure must not invite a duplicate submission.
      setMessage(result.notification ?? "Saved. Calendar notes and rental earnings update on the next sync, scheduled every 5 minutes.");
      try { await load(); } catch { setError("Your change was saved, but the updated view could not load. Press Refresh before making another change."); }
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn’t save this change."); return false; }
    finally { setBusy(false); }
  }
  async function pushAction(action: "enable" | "disable" | "test") {
    if (busy) return;
    // Permission must be requested directly from the tap, before any network I/O.
    const permission = action === "enable" && pushSupported ? Notification.requestPermission() : null;
    setBusy(true); setError(""); setMessage("");
    try {
      if (action === "enable") {
        if (!schedule?.pushPublicKey || !permission) throw new Error("Open this dashboard from your Home Screen to enable iPhone notifications.");
        await enableTeamPush(token, schedule.pushPublicKey, await permission); setPushEnabled(true);
        setMessage("Notifications enabled on this device. Use Send test to check delivery.");
      } else if (action === "disable") {
        await disableTeamPush(token); setPushEnabled(false); setMessage("Notifications disabled on this device.");
      } else {
        await teamRequest(token, "/push/test", {}); setMessage("Test queued. Look for a Smooth Studios schedule alert; delivery depends on your device settings.");
      }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Notification setup failed."); }
    finally { setBusy(false); }
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
  const days = Array.from({ length: 7 }, (_, i) => addLocalDays(`${week}T00:00`, i).slice(0, 10));
  function openAssignment(appointmentId = "") {
    setAssignment({ employeeId: filter !== "all" && filter !== "owner" ? filter : "akiva", appointmentId, title: "", instructions: "", overrideConflicts: false, ...initialPeriod() });
    setError(""); setAssignmentOpen(true);
  }
  function assignmentCard(item: TeamAssignment) {
    const appointment = schedule?.appointments.find(a => a.id === item.appointmentId);
    const busyConflicts = schedule ? assignmentConflicts(item.employeeId, item, schedule.blocks, schedule.assignments, schedule.appointments, item.id) : [];
    const conflictApproved = hasConflictOverride(item);
    return <article className="schedule-offer" key={item.id}>
      <div className="schedule-row"><Person id={item.employeeId} /><span className={`schedule-status ${item.status}`}>{item.status === "pending" && !future(item.start) ? "Needs Smooth’s review" : item.status}</span></div>
      <h3>{appointment?.title ?? item.title}</h3>
      {appointment?.customer && <p>{appointment.customer}</p>}
      <p><CalendarDays size={15} /> {date(item.start)} · {time(item.start)}–{time(item.end)}</p>
      <p className="schedule-small">{item.appointmentId ? "Calendar appointment · rental earnings follow existing payment rules" : "Custom assignment · scheduling only, no automatic commission"}</p>
      {item.instructions && <p className="schedule-instructions">{item.instructions}</p>}
      {item.note && <p className="schedule-notice">{item.note}</p>}
      {busyConflicts.length > 0 && <p className="schedule-warning">Conflict: {busyConflicts.join("; ")}. {conflictApproved ? "Smooth approved this time conflict. You can still accept the offer." : isOwner ? "You can approve this time conflict below." : "Ask Smooth to approve the conflict or adjust the assignment."}</p>}
      {conflictApproved && <p className="schedule-small">Time conflict override approved by Smooth for this appointment time.</p>}
      <div className="schedule-actions">
        {!isOwner && item.status === "pending" && future(item.start) && <>
          <Button disabled={busy || (busyConflicts.length > 0 && !conflictApproved)} onClick={() => void mutate(`/assignments/${item.id}`, { status: "accepted" })}><Check size={16} />Accept</Button>
          <Button disabled={busy} variant="outline" onClick={() => setConfirm({ path: `/assignments/${item.id}`, method: "POST", data: { status: "declined" }, description: `Decline ${item.title} on ${date(item.start)}? Smooth will see your response.` })}><X size={16} />Decline</Button>
        </>}
        {isOwner && future(item.start) && busyConflicts.length > 0 && !conflictApproved && <Button disabled={busy} variant="outline" onClick={() => setConfirm({ path: `/assignments/${item.id}`, method: "POST", data: { overrideConflicts: true }, description: `Allow ${personName(item.employeeId)} to accept ${item.title} despite the recorded conflicts for ${date(item.start)} at ${time(item.start)}? Their acceptance is still required. Changing the appointment time clears this approval.` })}>Allow time conflict</Button>}
        {isOwner && future(item.start) && <Button disabled={busy} variant="outline" onClick={() => setConfirm({ path: `/assignments/${item.id}`, method: "POST", data: { status: "cancelled" }, description: `Cancel ${personName(item.employeeId)}’s portal offer for ${item.title}? This does not remove any Google Calendar invitation.` })}>Cancel offer</Button>}
      </div>
    </article>;
  }

  return <section className="team-scheduling">
    <header className="schedule-intro"><div><p className="schedule-eyebrow">TEAM SCHEDULE</p><h2>{isOwner ? "The right person. The right time." : "Make room for what’s next."}</h2><p>Block class time and other commitments. Review rental offers and assignments here.</p></div>
      <Button disabled={busy || loading} variant="outline" onClick={async () => { setBusy(true); setError(""); try { await load(); setEnabled(true); } catch (e) { setError(e instanceof Error ? e.message : "Refresh failed."); } finally { setBusy(false); } }}><RefreshCw size={16} />Refresh</Button></header>
    {error && <p role="alert" className="schedule-error">{error}</p>}
    {message && <p role="status" className="schedule-success">{message}</p>}
    {loading && <div className="schedule-panel">Loading your schedule…</div>}
    {!loading && enabled === false && <div className="schedule-panel"><h3>Scheduling setup is waiting for deployment</h3><p>{isOwner ? "Your Cloudflare credentials are used securely by GitHub Actions. Activate below to deploy the Worker, prepare the database, and import Calendar. This area opens after all three succeed." : "Smooth is finishing setup. Your existing dashboard is unchanged."}</p>{isOwner && onSetup && <Button className="mt-4" onClick={onSetup}>Activate team scheduling</Button>}</div>}
    {schedule && <>
      {isOwner && calendarSync?.status === "needs_access" && <div className="schedule-warning" role="status"><strong>Google Calendar needs permission to show rental assignments</strong><p>In your rental calendar’s Settings and sharing, give <b>{calendarSync.serviceAccountEmail ?? "the existing dashboard service account"}</b> “Make changes to events” access. Rental team notes will appear after the next sync. Your assignments are saved here.</p></div>}
      {isOwner && calendarSync?.status === "retrying" && <p className="schedule-warning" role="status">Some rental team notes could not update in Google Calendar. They will retry on the next sync; your assignments are saved here.</p>}
      <div className="schedule-toolbar"><div className="schedule-actions">
        <Button onClick={() => { setError(""); setBlock({ userId: isOwner && filter !== "all" ? filter : userId, reason: "Class", ...initialPeriod(), repeatUntil: "", weekly: false }); setBlockOpen(true); }}><Plus size={16} />Block time</Button>
        {isOwner && <Button onClick={() => openAssignment()} variant="outline"><Plus size={16} />Assign work</Button>}
      </div><label className="schedule-filter">{isOwner ? "View team member" : "Your schedule"}{isOwner ? <select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Everyone</option>{TEAM.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select> : <Person id={userId} />}</label></div>
      <div className="schedule-notice"><ShieldCheck size={18} /><p>All times are Tallahassee time (Eastern). Calendar and payment syncing is scheduled every 5 minutes; portal responses update immediately. {isOwner ? "Check recorded commitments before assigning work. Employees confirm by accepting." : "A pending offer is confirmed when you select Accept."}</p></div>

      <article className="schedule-panel"><div className="schedule-row schedule-section-heading"><div><h3><CalendarDays size={20} />Week at a glance</h3><p>{date(localInstant(`${week}T12:00`))}–{date(localInstant(`${days[6]}T12:00`))} · {schedule.syncedAt ? `Calendar synced ${date(schedule.syncedAt)} at ${time(schedule.syncedAt)}` : "Waiting for Calendar"}</p></div><div className="schedule-actions">
        <Button size="icon" variant="outline" aria-label="Previous week" onClick={() => setWeek(addLocalDays(`${week}T00:00`, -7).slice(0, 10))}><ChevronLeft /></Button>
        <Button size="sm" variant="outline" onClick={() => setWeek(studioLocal(Date.now()).slice(0, 10))}>Today</Button>
        <Button size="icon" variant="outline" aria-label="Next week" onClick={() => setWeek(addLocalDays(`${week}T00:00`, 7).slice(0, 10))}><ChevronRight /></Button>
      </div></div>
      <div className="schedule-week">{days.map(day => {
        const from = localInstant(`${day}T00:00`), to = localInstant(addLocalDays(`${day}T00:00`, 1));
        const occurrences = blocks.flatMap(b => blockOccurrences(b, from, to)) as (TimeBlock & { start: string; end: string })[];
        const offers = visibleAssignments.filter(a => ["pending", "accepted"].includes(a.status) && overlaps(a, { start: from, end: to }));
        const calendar = schedule.appointments.filter(a => overlaps(a, { start: from, end: to }) &&
          (filter === "all" || a.acceptedEmployeeIds.includes(filter)));
        return <div className="schedule-day" key={day}><h4>{new Date(from).toLocaleDateString("en-US", { timeZone: STUDIO_ZONE, weekday: "short", day: "numeric", month: "short" })}</h4>
          {!occurrences.length && !offers.length && !calendar.length && <p className="schedule-empty-day">No recorded commitments</p>}
          {occurrences.map(b => <div className="schedule-entry blocked" key={`${b.id}-${b.start}`}><Person id={b.userId} /><strong>{b.reason}</strong><span>{time(b.start)}–{time(b.end)} · Blocked</span></div>)}
          {calendar.map(a => <div className="schedule-entry" key={a.id}><strong>{a.customer ? `${a.customer} · ` : ""}{a.title}</strong><span>{time(a.start)}–{time(a.end)}</span><small className={a.acceptedEmployeeIds.length ? "schedule-calendar-accepted" : undefined}>{a.acceptedEmployeeIds.length ? <><Check size={14} aria-hidden="true" />Calendar accepted: {a.acceptedEmployeeIds.map(personName).join(", ")}</> : offers.some(o => o.appointmentId === a.id) ? "Portal offer below" : "No accepted team member"}</small>{isOwner && future(a.start) && <button onClick={() => openAssignment(a.id)}>Assign person →</button>}</div>)}
          {offers.map(a => <div className={`schedule-entry ${a.status}`} key={a.id}><Person id={a.employeeId} /><strong>{a.title}</strong><span>{time(a.start)}–{time(a.end)} · {a.status}</span></div>)}
        </div>;
      })}</div></article>

      <article className="schedule-panel"><div className="schedule-section-heading"><h3><Clock3 size={20} />Offers & assignments <span className="schedule-count">{upcomingAssignments.length}</span></h3><p>{isOwner ? "Offers remain pending until the employee responds. To reassign, cancel the old portal offer and create a new one." : "Accept only when you can cover the full time. Need a change after accepting? Contact Smooth."}</p></div>
        <div className="schedule-offers">{upcomingAssignments.length ? upcomingAssignments.map(assignmentCard) : <p className="schedule-empty">No upcoming portal assignments for this view.</p>}</div>
        {visibleAssignments.some(a => !["pending", "accepted"].includes(a.status) || !future(a.end)) && <details className="schedule-history"><summary>Past offers & responses</summary>{visibleAssignments.filter(a => !["pending", "accepted"].includes(a.status) || !future(a.end)).slice(-50).reverse().map(a => <div key={a.id}><Person id={a.employeeId} /><span>{date(a.start)} · {a.title}</span><span>{a.status}</span></div>)}</details>}
      </article>

      <article className="schedule-panel"><div className="schedule-section-heading"><h3>Time off & class schedules <span className="schedule-count">{blocks.length}</span></h3><p>Reasons are visible only to Smooth and the person whose time is blocked. Add one weekly block for each class meeting day. Delete a series and add a replacement to change it.</p></div>
        {blocks.length ? <div className="schedule-blocks">{blocks.map(b => <div className="schedule-block" key={b.id}><div><Person id={b.userId} /><strong>{b.reason}</strong><p>{date(localInstant(b.startLocal))} · {time(localInstant(b.startLocal))}–{time(localInstant(b.endLocal))}{b.endLocal.slice(0, 10) !== b.startLocal.slice(0, 10) ? ` (${date(localInstant(b.endLocal))})` : ""}</p><small>{b.repeatUntil ? `Weekly through ${date(localInstant(`${b.repeatUntil}T12:00`))}` : "One-time block"}</small></div><Button aria-label={`Remove ${b.reason} block for ${personName(b.userId)}`} size="icon" variant="outline" disabled={busy} onClick={() => setConfirm({ path: `/blocks/${b.id}`, method: "DELETE", data: {}, description: `Remove ${b.reason}${b.repeatUntil ? " and all its weekly occurrences" : ""} for ${personName(b.userId)}? Existing assignments will not change.` })}><Trash2 size={16} /></Button></div>)}</div> : <p className="schedule-empty">No time blocks added yet.</p>}
      </article>

      <article className="schedule-panel schedule-push"><div><h3><Bell size={20} />Schedule notifications</h3><p>Receive a general alert, tap it, unlock your dashboard, and accept or decline here. No texts are sent.</p><p className="schedule-small">On iPhone: Safari → Share → Add to Home Screen. Open that icon, unlock, then enable notifications. Locking the dashboard turns off notifications on this device.</p>{!pushSupported && <p className="schedule-warning">This browser session does not support push. Use the Home Screen app on iPhone or a supported browser.</p>}</div><div className="schedule-actions">
        {pushEnabled ? <><Button variant="outline" disabled={busy} onClick={() => void pushAction("test")}>Send test</Button><Button variant="outline" disabled={busy} onClick={() => void pushAction("disable")}>Disable this device</Button></> : <Button disabled={busy || !pushSupported || !schedule.pushPublicKey} onClick={() => void pushAction("enable")}><Bell size={16} />Enable on this device</Button>}
      </div>{isOwner && <p className="schedule-small">Registered devices: {TEAM.map(p => `${p.name} ${schedule.devices[p.id] ?? 0}`).join(" · ")}. Registration does not guarantee delivery; focus mode and device settings can suppress alerts.</p>}</article>
      <p className="schedule-small">Studio rental offers and acceptances are listed in the Google Calendar event’s description after syncing. Existing Calendar invitations remain valid. Custom tasks stay in this dashboard.</p>
    </>}

    <Dialog open={blockOpen} onOpenChange={open => { if (!busy) setBlockOpen(open); }}><DialogContent className="schedule-modal"><DialogHeader><DialogTitle>Block availability</DialogTitle><DialogDescription>Class, personal time, or another commitment. Times are Eastern. Existing assignments are not cancelled.</DialogDescription></DialogHeader>
      <form onSubmit={async e => { e.preventDefault(); if (await mutate("/blocks", { ...block, repeatUntil: block.weekly ? block.repeatUntil : null })) setBlockOpen(false); }}>
        {isOwner && <label>Team member<select value={block.userId} onChange={e => setBlock({ ...block, userId: e.target.value })}>{TEAM.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
        <label>Reason<Input required maxLength={120} value={block.reason} onChange={e => setBlock({ ...block, reason: e.target.value })} placeholder="Class, personal time, another job…" /></label>
        <div className="schedule-form-pair"><label>Starts (Eastern)<Input required type="datetime-local" value={block.startLocal} onChange={e => setBlock({ ...block, startLocal: e.target.value })} /></label><label>Ends (Eastern)<Input required type="datetime-local" value={block.endLocal} onChange={e => setBlock({ ...block, endLocal: e.target.value })} /></label></div>
        <label className="schedule-check"><input type="checkbox" checked={block.weekly} onChange={e => setBlock({ ...block, weekly: e.target.checked })} />Repeat every week on this weekday</label>
        {block.weekly && <><p className="schedule-small">For a class that already started, use its original meeting date. The series must include an upcoming meeting.</p><label>Last date of the class or series<Input required type="date" min={block.startLocal.slice(0, 10)} max={addLocalDays(block.startLocal || `${week}T00:00`, 364).slice(0, 10)} value={block.repeatUntil} onChange={e => setBlock({ ...block, repeatUntil: e.target.value })} /></label></>}
        {error && <p className="schedule-error" role="alert">{error}</p>}
        <DialogFooter><Button disabled={busy} type="button" variant="outline" onClick={() => setBlockOpen(false)}>Cancel</Button><Button disabled={busy} type="submit">{busy ? "Saving…" : "Save time block"}</Button></DialogFooter>
      </form></DialogContent></Dialog>

    <Dialog open={assignmentOpen} onOpenChange={open => { if (!busy) setAssignmentOpen(open); }}><DialogContent className="schedule-modal"><DialogHeader><DialogTitle>Assign work</DialogTitle><DialogDescription>Create an offer for one employee. They confirm by accepting it in their dashboard.</DialogDescription></DialogHeader>
      <form onSubmit={async e => { e.preventDefault(); if (await mutate("/assignments", assignment)) setAssignmentOpen(false); }}>
        <label>Rental or assignment<select value={assignment.appointmentId} onChange={e => setAssignment({ ...assignment, appointmentId: e.target.value, overrideConflicts: false })}><option value="">Custom assignment (no automatic commission)</option>{appointments.map(a => <option key={a.id} value={a.id}>{date(a.start)} {time(a.start)} · {a.customer} · {a.title}</option>)}</select></label>
        {selectedAppointment ? <p className="schedule-notice">{date(selectedAppointment.start)} · {time(selectedAppointment.start)}–{time(selectedAppointment.end)} · {money(selectedAppointment.priceCents)}<br />Calendar controls this rental’s date and price.</p> : <><label>Assignment title<Input required maxLength={160} value={assignment.title} onChange={e => setAssignment({ ...assignment, title: e.target.value })} placeholder="Prepare the studio, assist on location…" /></label><div className="schedule-form-pair"><label>Starts (Eastern)<Input required type="datetime-local" value={assignment.startLocal} onChange={e => setAssignment({ ...assignment, startLocal: e.target.value, overrideConflicts: false })} /></label><label>Ends (Eastern)<Input required type="datetime-local" value={assignment.endLocal} onChange={e => setAssignment({ ...assignment, endLocal: e.target.value, overrideConflicts: false })} /></label></div></>}
        <label>Employee<select value={assignment.employeeId} onChange={e => setAssignment({ ...assignment, employeeId: e.target.value, overrideConflicts: false })}>{TEAM.filter(p => p.id !== "owner").map(p => <option key={p.id} value={p.id}>{p.name}{period && schedule && assignmentConflicts(p.id, period, schedule.blocks, schedule.assignments, schedule.appointments).length ? " — time conflict" : " — no recorded conflict"}</option>)}</select></label>
        {(conflicts.length > 0 || alreadyInvited || alreadyOffered) && <p className="schedule-warning">{alreadyInvited ? "This person already accepted the Calendar invitation." : alreadyOffered ? "This person already has an active offer for this appointment." : conflicts.join("; ")}</p>}
        {isOwner && conflicts.length > 0 && !alreadyInvited && !alreadyOffered && <label className="schedule-check"><input type="checkbox" checked={assignment.overrideConflicts} onChange={e => setAssignment({ ...assignment, overrideConflicts: e.target.checked })} />Allow this time conflict. The employee still needs to accept.</label>}
        <label>Instructions (optional)<Textarea maxLength={2000} rows={3} value={assignment.instructions} onChange={e => setAssignment({ ...assignment, instructions: e.target.value })} placeholder="Arrival instructions, responsibilities, anything to prepare…" /></label>
        <p className="schedule-small">A push alert is queued if this employee has enabled notifications. The offer appears in the portal even if the alert cannot be delivered.</p>
        {error && <p className="schedule-error" role="alert">{error}</p>}
        <DialogFooter><Button disabled={busy} type="button" variant="outline" onClick={() => setAssignmentOpen(false)}>Cancel</Button><Button disabled={busy || (conflicts.length > 0 && !assignment.overrideConflicts) || alreadyInvited || alreadyOffered || !period} type="submit">{busy ? "Sending…" : "Send assignment offer"}</Button></DialogFooter>
      </form></DialogContent></Dialog>

    <Dialog open={Boolean(confirm)} onOpenChange={open => { if (!open && !busy) setConfirm(null); }}><DialogContent className="schedule-modal"><DialogHeader><DialogTitle>Confirm change</DialogTitle><DialogDescription>{confirm?.description}</DialogDescription></DialogHeader>{error && <p className="schedule-error" role="alert">{error}</p>}<DialogFooter><Button disabled={busy} variant="outline" onClick={() => setConfirm(null)}>Go back</Button><Button disabled={busy} onClick={async () => { if (confirm && await mutate(confirm.path, confirm.data, confirm.method)) setConfirm(null); }}>Confirm</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
