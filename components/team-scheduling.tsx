"use client";
import { AppointmentDetail } from "@/components/appointment-detail";
import { OwnerDailyActions } from "@/components/dashboard/daily-actions";
import { MoreOptions } from "@/components/dashboard/more-options";
import { PersonLabel } from "@/components/dashboard/person-label";
import { RentalDescription } from "@/components/rental-description";
import { ScheduleConfirmation } from "@/components/schedule-confirmation";
import { TimeBlockDialog } from "@/components/time-block-dialog";
import { AppPicker,ConfirmationRow } from "@/components/ui/app-controls";
import { buildScheduleAgenda } from "@/lib/schedule-agenda.mjs";
import type { WorkEntry } from "@/lib/schedule-calendar-types";

import { PersonAvatar } from "@/components/team-profile";
import { CalendarAssignmentStatus } from "@/components/calendar-assignment-status";
import { useRefreshSource } from "@/components/dashboard-refresh";
import { EmployeeHome,type EmployeeHomeOptions } from "@/components/employee-home";
import { OwnerScheduleAgenda } from "@/components/owner-schedule-agenda";
import { RentalSuggestions } from "@/components/rental-suggestions";
import { TeamAvailability } from "@/components/team-availability";
import { Button } from "@/components/ui/button";
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { rentalAlertTargetId,rentalAppointmentId } from "@/lib/alert-target.mjs";
import { appointmentResponsePrompt,calendarInvitationLabel,calendarInvitationStatus,pendingCalendarInvitations } from "@/lib/calendar-invitations.mjs";
import type { DashboardPayload } from "@/lib/dashboard-types";
import { hapticFeedback } from "@/lib/haptics.mjs";
import { teamPushIsEnabled,teamRequest,type TeamAppointment,type TeamAssignment,type TeamSchedule,type TimeBlock,type WorkPreference } from "@/lib/team-api";
import { saveScheduleMutation,scheduleMutationError,scheduleMutationMessage } from "@/lib/team-schedule-mutations.mjs";
import { addLocalDays,assignmentConflicts,blockOccurrences,hasConflictOverride,localInstant,overlaps,STUDIO_ZONE,studioLocal,TEAM,workPreferenceMatch } from "@/lib/team-schedule.mjs";
import { Bell,CalendarDays,Check,ChevronLeft,ChevronRight,Clock3,Plus,ShieldCheck,X } from "lucide-react";
import { useCallback,useEffect,useMemo,useRef,useState,type ReactNode } from "react";

const personName = (id: string) => TEAM.find(p => p.id === id)?.name ?? id;
const time = (value: string) => new Date(value).toLocaleTimeString("en-US", { timeZone: STUDIO_ZONE, hour: "numeric", minute: "2-digit" });
const date = (value: string) => new Date(value).toLocaleDateString("en-US", { timeZone: STUDIO_ZONE, month: "short", day: "numeric" });
const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const future = (value: string) => Date.parse(value) > Date.now();
const initialPeriod = () => {
  const day = addLocalDays(studioLocal(Date.now()), 1).slice(0, 10);
  return { startLocal: `${day}T09:00`, endLocal: `${day}T10:00` };
};
const Person = PersonLabel;

export function TeamSchedulingPage({ userId, isOwner, token, onSetup, calendarSync, home, pastContent, availabilityOnly = false, onAvailability, onChecklist, focusId, onCloseFocus, ownerHome, onPayment }: { ownerHome?: { onSchedule: () => void }; onPayment?: (id: string) => void; focusId?: string; onCloseFocus?: () => void; userId: string; isOwner: boolean; token: string; onSetup?: () => void; calendarSync?: DashboardPayload["calendarAssignmentSync"]; home?: EmployeeHomeOptions; pastContent?: ReactNode; availabilityOnly?: boolean; onAvailability?: () => void; onChecklist?: () => void }) {
  const isHome = Boolean(home || ownerHome);
  const [detailId, setDetailId] = useState<string | null>(null);
  const closeDetail = () => { setDetailId(null); onCloseFocus?.(); };
  const openWork = (item: WorkEntry) => { setDetailId(item.appointment ? rentalAlertTargetId(item.appointment.id) : item.assignments[0]?.id ?? null); };
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
  const [assignment, setAssignment] = useState({ employeeId: "", appointmentId: "", title: "", instructions: "", overrideConflicts: false, confirmWorked: false, confirmedStart: "", confirmedEnd: "", ...initialPeriod() });

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
        write: (revision: number) => teamRequest<{ notification?: string; removedAssignment?: TeamAssignment }>(token, path, { ...data, revision }, method),
        refresh: () => teamRequest<TeamSchedule>(token, "/schedule"),
        onRefresh: (fresh: TeamSchedule) => { setSchedule(fresh); setNeedsRefresh(false); },
      });
      setNeedsRefresh(true);
      // Reflect a confirmed response immediately, even if the follow-up read fails.
      if (path.startsWith("/assignments/") && "status" in data && ["accepted", "declined", "cancelled"].includes(String(data.status))) {
        setSchedule(current => current ? { ...current, assignments: current.assignments.map(a => a.id === path.slice(13) ? { ...a, status: data.status as TeamAssignment["status"] } : a) } : current);
      }
      if (path === "/rental-staff/remove" && result.removedAssignment) {
        const removed = result.removedAssignment;
        setSchedule(current => current ? { ...current,
          appointments: current.appointments.map(a => a.id === removed.appointmentId ? { ...a,
            acceptedEmployeeIds: a.acceptedEmployeeIds.filter(id => id !== removed.employeeId),
            calendarInvitations: a.calendarInvitations?.filter(person => person.employeeId !== removed.employeeId) } : a),
          assignments: [...current.assignments.filter(a => a.id !== removed.id).map(a => a.appointmentId === removed.appointmentId && a.employeeId === removed.employeeId &&
            a.start === removed.start && a.end === removed.end && ["pending", "accepted"].includes(a.status) ? { ...a, status: "cancelled" as const } : a), removed],
        } : current);
      }
      // Once saved, a refresh failure must not invite a duplicate submission.
      setMessage(scheduleMutationMessage(path, data, method, result));
      hapticFeedback("success");
      try { await load(); } catch { setError("Your change was saved, but the updated view could not load. Try again to load the latest view before making another change."); }
      return true;
    } catch (e) { setError(scheduleMutationError(path, e)); hapticFeedback("warning"); return false; }
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

  const appointments = useMemo(() => (schedule?.appointments ?? []).filter(a => future(a.start) || a.id === assignment.appointmentId).sort((a, b) => Date.parse(a.start) - Date.parse(b.start)), [schedule, assignment.appointmentId]);
  const selectedAppointment = appointments.find(a => a.id === assignment.appointmentId);
  const startedRental = Boolean(selectedAppointment && !future(selectedAppointment.start));
  const workConfirmed = assignment.confirmWorked && assignment.confirmedStart === selectedAppointment?.start && assignment.confirmedEnd === selectedAppointment?.end;
  let period: { start: string; end: string; appointmentId?: string } | null = null;
  try { period = selectedAppointment ? { ...selectedAppointment, appointmentId: selectedAppointment.id } : assignment.appointmentId ? null : { start: localInstant(assignment.startLocal), end: localInstant(assignment.endLocal) }; } catch { /* Field validation below. */ }
  const existingPending = startedRental ? schedule?.assignments.find(a => a.appointmentId === selectedAppointment?.id && a.employeeId === assignment.employeeId && a.status === "pending") : undefined;
  const conflicts = period && schedule ? assignmentConflicts(assignment.employeeId, period, schedule.blocks, schedule.assignments, schedule.appointments, existingPending?.id) : [];
  const alreadyInvited = selectedAppointment?.acceptedEmployeeIds.includes(assignment.employeeId);
  const alreadyOffered = Boolean(selectedAppointment && schedule?.assignments.some(a => a.appointmentId === selectedAppointment.id && a.employeeId === assignment.employeeId && (a.status === "accepted" || (!startedRental && a.status === "pending"))));
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
    setAssignment({ employeeId: "", appointmentId, title: "", instructions: "", overrideConflicts: false, confirmWorked: false, confirmedStart: "", confirmedEnd: "", ...initialPeriod() });
    setError(""); setAssignmentOpen(true);
  }
  function openBlockTime(id?: string) {
    setError(""); setBlock({ userId: isOwner ? id ?? "" : userId, reason: "", ...initialPeriod(), repeatUntil: "", weekly: false }); setBlockOpen(true);
  }
  async function refreshManually() {
    if (mutationInFlight.current || busy) return false;
    setBusy(true); setError("");
    try { await load(); setEnabled(true); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "Refresh failed."); return false; }
    finally { setBusy(false); }
  }
  useRefreshSource(refreshManually);
  async function removePerson(appointment: TeamAppointment, employeeId: string) {
    return mutate("/rental-staff/remove", { appointmentId: appointment.id, employeeId, start: appointment.start, end: appointment.end });
  }
  const feedback = <>{message && <p role="status" className="schedule-success">{message}</p>}{error && <div role="alert" className="schedule-error"><p>{error}</p><Button disabled={busy} variant="outline" onClick={() => void refreshManually()}>Reload schedule</Button></div>}</>;
  function assignmentCard(item: TeamAssignment, compact = false, onRemove?: () => void) {
    const pendingChange = confirm?.path === `/assignments/${item.id}` ? confirm : null;
    const action = pendingChange && "status" in pendingChange.data ? pendingChange.data.status : "override";
    const actionLabel = action === "cancelled" ? "Cancel offer" : action === "declined" ? "Decline offer" : "Allow conflict";
    const appointment = schedule?.appointments.find(a => a.id === item.appointmentId);
    const busyConflicts = schedule ? assignmentConflicts(item.employeeId, item, schedule.blocks, schedule.assignments, schedule.appointments, item.id) : [];
    const conflictApproved = hasConflictOverride(item);
    return <article className="schedule-offer" key={item.id}>
      <div className="schedule-row">{(!isHome || isOwner) && <span className="offer-person"><PersonAvatar personId={item.employeeId} /><strong>{personName(item.employeeId)}</strong></span>}<span className={`schedule-status ${item.status}`}>{item.status === "pending" && !future(item.start) ? "Needs Smooth’s review" : !isOwner && item.status === "pending" ? "Awaiting your response" : item.status === "accepted" && item.ownerConfirmation ? "Confirmed by Smooth" : item.status === "pending" ? "Awaiting response" : item.status === "accepted" ? "Accepted in app" : item.status}</span></div>
      {!compact && <h3>{appointment?.title ?? item.title}</h3>}
      {!compact && appointment?.customer && <p>{appointment.customer}</p>}
      {!compact && <p><CalendarDays size={15} /> {date(item.start)} · {time(item.start)}–{time(item.end)}</p>}
      {!compact && (!home || !item.appointmentId) && <p className="schedule-small">{item.appointmentId ? "Calendar appointment · rental earnings follow existing payment rules" : "Custom assignment · confirm pay with Smooth"}</p>}
      {!compact && !home && appointment && /studio.*rental|rental.*studio/i.test(appointment.title) && <RentalDescription details={appointment.rentalDetails} />}
      {item.instructions && <p className="schedule-instructions">{item.instructions}</p>}
      {item.note && <p className="schedule-notice">{item.note}</p>}
      {item.calendarSync && <details className="offer-calendar-status"><summary>Calendar sync</summary><CalendarAssignmentStatus delivery={item.calendarSync} /><p className="schedule-small">App responses save independently of Google Calendar.</p></details>}
      {busyConflicts.length > 0 && <p className="schedule-warning">Conflict: {busyConflicts.join("; ")}. {conflictApproved ? "Smooth approved this time conflict. You can still accept the offer." : isOwner ? "You can approve this time conflict below." : "Ask Smooth to approve the conflict or adjust the assignment."}</p>}
      {conflictApproved && <p className="schedule-small">Time conflict override approved by Smooth for this appointment time.</p>}
      <div className="schedule-actions">
        {!compact && item.appointmentId && <Button variant="outline" onClick={() => setDetailId(rentalAlertTargetId(item.appointmentId!))}>View rental details</Button>}
        {isOwner && item.status === "pending" && future(item.start) && <Button disabled={busy || needsRefresh} variant="outline" onClick={() => void remindAssignment(item)}><Bell size={16} />{busy ? "Sending…" : "Remind"}</Button>}
        {!compact && onChecklist && item.appointmentId && item.status === "accepted" && /studio.*rental|rental.*studio/i.test(item.title) && <Button variant="outline" onClick={() => setDetailId(rentalAlertTargetId(item.appointmentId!))}>Open rental & checklist</Button>}
        {!isOwner && item.status === "pending" && future(item.start) && <>
          <Button disabled={busy || needsRefresh || (busyConflicts.length > 0 && !conflictApproved)} onClick={() => void mutate(`/assignments/${item.id}`, { status: "accepted" })}><Check size={16} />{busy ? "Saving…" : item.appointmentId ? "Accept rental" : "Accept assignment"}</Button>
          <Button disabled={busy || needsRefresh} variant="outline" onClick={() => setConfirm({ path: `/assignments/${item.id}`, method: "POST", data: { status: "declined" }, description: `Decline ${item.title} on ${date(item.start)}? Smooth will see your response.` })}><X size={16} />Decline</Button>
        </>}
        {isOwner && ["pending", "accepted"].includes(item.status) && future(item.start) && busyConflicts.length > 0 && !conflictApproved && <Button disabled={busy || needsRefresh} variant="outline" onClick={() => setConfirm({ path: `/assignments/${item.id}`, method: "POST", data: { overrideConflicts: true }, description: `Allow ${personName(item.employeeId)} to accept ${item.title} despite the recorded conflicts for ${date(item.start)} at ${time(item.start)}? Their acceptance is still required. Changing the appointment time clears this approval.` })}>Allow time conflict</Button>}
        {isOwner && onRemove && future(item.start) && <Button disabled={busy || needsRefresh} variant="outline" onClick={onRemove}>Remove person</Button>}
        {isOwner && !onRemove && ["pending", "accepted"].includes(item.status) && future(item.start) && <Button disabled={busy || needsRefresh} variant="outline" haptic="light" onClick={() => { setError(""); setConfirm({ path: `/assignments/${item.id}`, method: "POST", data: { status: "cancelled" }, description: `Cancel ${personName(item.employeeId)}’s app offer for ${item.title}? The app will also remove an invitation it created. Invitations added separately in Google Calendar stay available. Use Remove person to remove them from the rental completely.` }); }}>Cancel offer</Button>}
      </div>
      {pendingChange && <ScheduleConfirmation>
        <p>{pendingChange.description}</p>
        {error && <p className="schedule-error" role="alert">{error}</p>}
        <div className="schedule-actions"><Button disabled={busy} variant="outline" onClick={() => setConfirm(null)}>Cancel</Button><Button variant={action === "override" ? "default" : "destructive"} disabled={busy || needsRefresh} aria-busy={busy} onClick={async () => { if (await mutate(pendingChange.path, pendingChange.data, pendingChange.method)) setConfirm(null); }}>{busy ? action === "cancelled" ? "Cancelling…" : "Saving…" : actionLabel}</Button></div>
      </ScheduleConfirmation>}
    </article>;
  }

  const activeDetailId = detailId ?? focusId;
  const focusedRentalId = rentalAppointmentId(activeDetailId);
  const focusedItem = focusedRentalId ? undefined : schedule?.assignments.find(item => item.id === activeDetailId);
  const focusedRental = schedule?.appointments.find(item => item.id === (focusedRentalId ?? focusedItem?.appointmentId));
  const detailSource = focusedRental ?? focusedItem;
  const detailEntry = schedule && detailSource ? (buildScheduleAgenda(schedule, { from: detailSource.start, to: detailSource.end }) as WorkEntry[]).find(item => item.kind === "work" && (focusedRental ? item.appointment?.id === focusedRental.id : item.assignments.some(offer => offer.id === focusedItem?.id))) : undefined;
  return <section className="team-scheduling">
    {error && <div role="alert" className="schedule-error"><p>{error}</p><Button disabled={busy} variant="outline" onClick={() => void refreshManually()}>Try again</Button></div>}
    {message && <p role="status" className="schedule-success">{message}</p>}
    {ownerHome && <OwnerDailyActions schedule={schedule} loading={loading} onOpen={openWork} onSchedule={ownerHome.onSchedule} />}
    {home && <EmployeeHome userId={userId} schedule={schedule} loading={loading} options={home} onBlockTime={() => openBlockTime()} renderOffer={assignmentCard} onOpenRental={id => setDetailId(rentalAlertTargetId(id))} />}
    {!isHome && !availabilityOnly && !isOwner && <nav className="employee-schedule-tabs" aria-label="Schedule views"><Button variant={scheduleTab === "upcoming" ? "default" : "outline"} aria-pressed={scheduleTab === "upcoming"} onClick={() => setScheduleTab("upcoming")}>Upcoming</Button><Button variant={scheduleTab === "past" ? "default" : "outline"} aria-pressed={scheduleTab === "past"} onClick={() => setScheduleTab("past")}>Past</Button></nav>}
    {!isHome && !availabilityOnly && !isOwner && scheduleTab === "past" && <>{pastContent}<article className="schedule-panel"><h3>Past offers & responses</h3>{visibleAssignments.filter(a => !["pending", "accepted"].includes(a.status) || !future(a.end)).length ? <div className="schedule-history employee-past-offers">{visibleAssignments.filter(a => !["pending", "accepted"].includes(a.status) || !future(a.end)).slice(-50).reverse().map(a => <div key={a.id}><span>{date(a.start)} · {a.title}</span><span className="schedule-status">{a.status === "accepted" && a.ownerConfirmation ? "Confirmed by Smooth" : a.status}</span></div>)}</div> : <p className="schedule-empty">{loading ? "Loading past offers…" : "No past offers in this view."}</p>}</article></>}
    {loading && !isHome && <div className="schedule-panel">Loading your schedule…</div>}
    {!loading && enabled === false && <div className="schedule-panel"><h3>Scheduling setup is waiting for deployment</h3><p>{isOwner ? "Your Cloudflare credentials are used securely by GitHub Actions. Activate below to deploy the Worker, prepare the database, and import Calendar. This area opens after all three succeed." : "Smooth is finishing setup. Your existing dashboard is unchanged."}</p>{isOwner && onSetup && <Button className="mt-4" onClick={onSetup}>Activate team scheduling</Button>}</div>}
    {schedule && !isHome && availabilityOnly && <TeamAvailability userId={userId} isOwner={isOwner} schedule={schedule} busy={busy} needsRefresh={needsRefresh} error={error} mutate={mutate} onBlockTime={openBlockTime} />}
    {schedule && !isHome && !availabilityOnly && (isOwner || scheduleTab === "upcoming") && <>
      {isOwner && calendarSync?.status === "needs_access" && <div className="schedule-warning" role="status"><strong>Google Calendar needs permission to show rental assignments</strong><p>In your rental calendar’s Settings and sharing, give <b>{calendarSync.serviceAccountEmail ?? "the existing dashboard service account"}</b> “Make changes to events” access. Rental team notes will appear after the next sync. Your assignments are saved here.</p></div>}
      {isOwner && calendarSync?.status === "retrying" && <p className="schedule-warning" role="status">Some rental team notes could not update in Google Calendar. They will retry on the next sync; your assignments are saved here.</p>}
      {isOwner ? <OwnerScheduleAgenda onOpenWork={openWork} feedback={feedback} onRemovePerson={removePerson} onChecklist={onChecklist} schedule={schedule} employeeId={filter} onEmployeeChange={setFilter} onAssign={openAssignment} onAvailability={onAvailability ?? (() => openBlockTime())} busy={busy} renderAssignment={assignmentCard} /> : <>
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
          {calendar.map(a => <div className="schedule-entry" key={a.id}><strong>{a.customer ? `${a.customer} · ` : ""}{a.title}</strong><span>{time(a.start)}–{time(a.end)}</span><small className={a.acceptedEmployeeIds.length ? "schedule-calendar-accepted" : undefined}>{a.cancelled ? "Cancelled · no team approval" : a.teamRenterId ? `Team rental · ${personName(a.teamRenterId)}` : appointmentResponsePrompt(a, offers, userId)}</small>{pendingCalendarInvitations(a).map(invitation => <small key={invitation.employeeId}>{personName(invitation.employeeId)} · {calendarInvitationLabel(invitation.status)}</small>)}{/studio.*rental|rental.*studio/i.test(a.title) && <details className="rental-details-toggle"><summary>Rental details</summary><RentalDescription details={a.rentalDetails} /></details>}<Button variant="outline" onClick={() => setDetailId(rentalAlertTargetId(a.id))}>Open appointment</Button></div>)}
          {offers.map(a => <div className={`schedule-entry ${a.status}`} key={a.id}><Person id={a.employeeId} /><strong>{a.title}</strong><span>{time(a.start)}–{time(a.end)} · {a.status === "accepted" && a.ownerConfirmation ? "Confirmed by Smooth" : a.status}</span></div>)}
        </div>;
      })}</div></article>

      <article className="schedule-panel"><div className="schedule-section-heading"><h3><Clock3 size={20} />Offers & assignments <span className="schedule-count">{upcomingAssignments.length}</span></h3><p>{isOwner ? "Offers remain pending until the employee responds. To reassign, cancel the old portal offer and create a new one." : "Accept only when you can cover the full time. Need a change after accepting? Contact Smooth."}</p></div>
        <div className="schedule-offers">{upcomingAssignments.length ? upcomingAssignments.map(item => assignmentCard(item)) : <p className="schedule-empty">No upcoming portal assignments for this view.</p>}</div>
        {isOwner && visibleAssignments.some(a => !["pending", "accepted"].includes(a.status) || !future(a.end)) && <details className="schedule-history"><summary>Past offers & responses</summary>{visibleAssignments.filter(a => !["pending", "accepted"].includes(a.status) || !future(a.end)).slice(-50).reverse().map(a => <div key={a.id}><Person id={a.employeeId} /><span>{date(a.start)} · {a.title}</span><span>{a.status === "accepted" && a.ownerConfirmation ? "Confirmed by Smooth" : a.status}</span></div>)}</details>}
      </article>


      <p className="schedule-small">Studio rental offers and acceptances are listed in the Google Calendar event’s description after syncing. Existing Calendar invitations remain valid. Custom tasks stay in this dashboard.</p>
      </>}
    </>}


    <TimeBlockDialog blockOpen={blockOpen} setBlockOpen={setBlockOpen} block={block} setBlock={setBlock} busy={busy} needsRefresh={needsRefresh} isOwner={isOwner} error={error} mutate={mutate} />

    <Dialog open={assignmentOpen} onOpenChange={open => { if (!busy) setAssignmentOpen(open); }}><DialogContent presentation="sheet" closeDisabled={busy} className="schedule-modal assignment-dialog app-task-sheet"><DialogHeader><DialogTitle>{startedRental ? "Record rental staff" : "Assign work"}</DialogTitle><DialogDescription>{startedRental ? "Confirm who is working or worked this rental." : "They can accept or decline in the app."}</DialogDescription></DialogHeader>
      <form className="app-sheet-form" onSubmit={async e => { e.preventDefault(); if (await mutate("/assignments", assignment)) setAssignmentOpen(false); }}><div className="app-sheet-scroll">
        <AppPicker label="Rental or assignment" value={assignment.appointmentId} disabled={busy} onValueChange={appointmentId => setAssignment({ ...assignment, appointmentId, overrideConflicts: false, confirmWorked: false, confirmedStart: "", confirmedEnd: "" })} options={[{ value: "", label: "Custom assignment", description: "No automatic commission" }, ...appointments.map(a => ({ value: a.id, label: a.customer || a.title, description: `${date(a.start)} · ${time(a.start)}–${time(a.end)} · ${a.title}` }))]} />
        {selectedAppointment ? <div className="app-booking-summary"><CalendarDays size={20} aria-hidden="true" /><div><strong>{date(selectedAppointment.start)} · {time(selectedAppointment.start)}–{time(selectedAppointment.end)}</strong><small>Rental time and price from Calendar</small></div><b>{money(selectedAppointment.priceCents)}</b></div> : <><label>Assignment title<Input required maxLength={160} value={assignment.title} onChange={e => setAssignment({ ...assignment, title: e.target.value })} placeholder="Prepare the studio, assist on location…" /></label><div className="schedule-form-pair"><label>Starts<Input required type="datetime-local" value={assignment.startLocal} onChange={e => setAssignment({ ...assignment, startLocal: e.target.value, overrideConflicts: false, confirmWorked: false, confirmedStart: "", confirmedEnd: "" })} /></label><label>Ends<Input required type="datetime-local" value={assignment.endLocal} onChange={e => setAssignment({ ...assignment, endLocal: e.target.value, overrideConflicts: false, confirmWorked: false, confirmedStart: "", confirmedEnd: "" })} /></label></div></>}
        <AppPicker label="Employee" required placeholder="Choose a person" value={assignment.employeeId} disabled={busy} onValueChange={employeeId => setAssignment({ ...assignment, employeeId, overrideConflicts: false, confirmWorked: false, confirmedStart: "", confirmedEnd: "" })} options={TEAM.filter(p => p.id !== "owner").map(p => ({ value: p.id, label: p.name, color: p.color, description: period ? employeeAvailabilityLabel(p.id) : undefined }))} />
        {!startedRental && !assignment.employeeId && period && schedule && <details className="offer-suggestions"><summary>Suggested people</summary><RentalSuggestions period={period} schedule={schedule} busy={busy || needsRefresh} onChoose={id => setAssignment({ ...assignment, employeeId: id, overrideConflicts: false, confirmWorked: false, confirmedStart: "", confirmedEnd: "" })} /></details>}
        {!startedRental && assignment.employeeId && period && schedule?.availabilityVersion === 1 && !conflicts.length && <p className={selectedPreference === "full" ? "schedule-success" : "schedule-notice"}>{selectedPreference === "full" ? `${personName(assignment.employeeId)} prefers this time. Acceptance is still required.` : selectedPreference === "partial" ? "Partly outside their preferred hours. They can still accept." : "No preference recorded. You can still send an offer."}</p>}
        {(conflicts.length > 0 || alreadyInvited || alreadyOffered) && <p className="schedule-warning">{alreadyInvited ? "This person already accepted the Calendar invitation." : alreadyOffered ? "This person already has an active offer for this appointment." : conflicts.join("; ")}</p>}
        {isOwner && conflicts.length > 0 && !alreadyInvited && !alreadyOffered && <ConfirmationRow tone="warning" checked={assignment.overrideConflicts} disabled={busy} onCheckedChange={overrideConflicts => setAssignment({ ...assignment, overrideConflicts })}>{startedRental ? "Allow this time conflict for the work I am confirming." : "Allow this time conflict. The employee still needs to accept."}</ConfirmationRow>}
        {startedRental && selectedAppointment && assignment.employeeId && <ConfirmationRow checked={workConfirmed} disabled={busy} onCheckedChange={confirmWorked => setAssignment({ ...assignment, confirmWorked, confirmedStart: selectedAppointment.start, confirmedEnd: selectedAppointment.end })} description="Counts toward rental hours and earnings under the existing payment rules.">I confirm {personName(assignment.employeeId)} {future(selectedAppointment.end) ? "is working" : "worked"} this rental at the displayed time.</ConfirmationRow>}
        <MoreOptions><label>Instructions (optional)<Textarea maxLength={2000} rows={3} value={assignment.instructions} onChange={e => setAssignment({ ...assignment, instructions: e.target.value })} placeholder="Arrival instructions, responsibilities, anything to prepare…" /></label></MoreOptions>
        {assignment.employeeId && <p className="schedule-small">{startedRental ? "Saved as Confirmed by Smooth. This does not record a payment." : schedule?.devices[assignment.employeeId] ? `${personName(assignment.employeeId)} will be notified in the app and on enabled devices.` : `${personName(assignment.employeeId)} can view and accept this in the app. Device alerts are off.`}</p>}
        {error && <p className="schedule-error" role="alert">{error}</p>}
        </div><DialogFooter><Button disabled={busy} type="button" variant="outline" onClick={() => setAssignmentOpen(false)}>Cancel</Button><Button disabled={busy || needsRefresh || !assignment.employeeId || (conflicts.length > 0 && !assignment.overrideConflicts) || alreadyInvited || alreadyOffered || !period || (startedRental && !workConfirmed)} type="submit">{busy ? "Saving…" : error ? "Try again" : startedRental ? "Record person" : "Send offer"}</Button></DialogFooter>
      </form></DialogContent></Dialog>

    <Dialog open={Boolean(activeDetailId)} onOpenChange={open => { if (!open && !busy) closeDetail(); }}><DialogContent presentation="sheet" closeDisabled={busy} className="schedule-modal appointment-dialog app-task-sheet"><DialogHeader><DialogTitle>{focusedRentalId || focusedRental ? "Appointment details" : "Assignment details"}</DialogTitle><DialogDescription>{focusedRentalId ? "Review the current rental and its team responses." : "Review the current assignment and its response."}</DialogDescription></DialogHeader>
      <div className="app-sheet-scroll">{detailEntry ? <AppointmentDetail item={detailEntry} token={token} userId={userId} isOwner={isOwner} busy={busy} renderAssignment={assignmentCard} onAssign={id => { closeDetail(); openAssignment(id); }} onRemovePerson={removePerson} onPayment={onPayment ? id => { closeDetail(); onPayment(id); } : undefined} feedback={feedback} /> : focusedItem ? assignmentCard(focusedItem) : <p role="status">{loading ? "Loading appointment…" : "This appointment is no longer available to this account."}</p>}</div>
    </DialogContent></Dialog>


  </section>;
}
