"use client";
import { AppointmentDetail } from "@/components/appointment-detail";
import { OwnerDailyActions } from "@/components/dashboard/daily-actions";
import { PersonLabel } from "@/components/dashboard/person-label";
import { RentalDescription } from "@/components/rental-description";
import { TimeBlockDialog } from "@/components/time-block-dialog";
import { buildScheduleAgenda } from "@/lib/schedule-agenda.mjs";
import type { WorkEntry } from "@/lib/schedule-calendar-types";

import { useRefreshSource } from "@/components/dashboard-refresh";
import { EmployeeHome,type EmployeeHomeOptions } from "@/components/employee-home";
import { OwnerScheduleAgenda } from "@/components/owner-schedule-agenda";
import { TeamAvailability } from "@/components/team-availability";
import { Button } from "@/components/ui/button";
import { Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { rentalAlertTargetId,rentalAppointmentId } from "@/lib/alert-target.mjs";
import { appointmentResponsePrompt,calendarInvitationLabel,calendarInvitationStatus,pendingCalendarInvitations } from "@/lib/calendar-invitations.mjs";
import type { DashboardPayload } from "@/lib/dashboard-types";
import type { TeamAppointment, TeamAssignment, TimeBlock, WorkPreference } from "@/lib/team-api";
import { useTeamSchedule } from "@/lib/use-team-schedule";
import { addLocalDays,blockOccurrences,localInstant,overlaps,STUDIO_ZONE,studioLocal,TEAM } from "@/lib/team-schedule.mjs";
import { CalendarDays,ChevronLeft,ChevronRight,Clock3,Plus,ShieldCheck } from "lucide-react";
import { useMemo,useState,type ReactNode } from "react";

import { AssignmentDialog } from "@/components/scheduling/assignment-dialog";
import { AssignmentOffer } from "@/components/scheduling/assignment-offer";
import { date, time, future, personName, initialPeriod, type ScheduleConfirmationChange } from "@/components/scheduling/shared";

const Person = PersonLabel;

export function TeamSchedulingPage({ userId, isOwner, token, onSetup, calendarSync, home, pastContent, availabilityOnly = false, onAvailability, onChecklist, focusId, onCloseFocus, ownerHome, onPayment }: { ownerHome?: { onSchedule: () => void }; onPayment?: (id: string) => void; focusId?: string; onCloseFocus?: () => void; userId: string; isOwner: boolean; token: string; onSetup?: () => void; calendarSync?: DashboardPayload["calendarAssignmentSync"]; home?: EmployeeHomeOptions; pastContent?: ReactNode; availabilityOnly?: boolean; onAvailability?: () => void; onChecklist?: () => void }) {
  const isHome = Boolean(home || ownerHome);
  const [detailId, setDetailId] = useState<string | null>(null);
  const closeDetail = () => { setDetailId(null); onCloseFocus?.(); };
  const openWork = (item: WorkEntry) => { setDetailId(item.appointment ? rentalAlertTargetId(item.appointment.id) : item.assignments[0]?.id ?? null); };
  const { schedule, loading, enabled, error, setError, message, busy, needsRefresh, mutate, remindAssignment, refreshManually } = useTeamSchedule({ token, userId, isOwner, availabilityOnly });
  const [scheduleTab, setScheduleTab] = useState<"upcoming" | "past">("upcoming");
  const [filter, setFilter] = useState(isOwner ? "all" : userId);
  const [week, setWeek] = useState(() => studioLocal(Date.now()).slice(0, 10));
  const [blockOpen, setBlockOpen] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [confirm, setConfirm] = useState<ScheduleConfirmationChange | null>(null);
  const [block, setBlock] = useState({ userId, reason: "", ...initialPeriod(), repeatUntil: "", weekly: false });
  const [assignmentAppointmentId, setAssignmentAppointmentId] = useState("");

  const visibleAssignments = useMemo(() => (schedule?.assignments ?? []).filter(a => filter === "all" || a.employeeId === filter).sort((a, b) => Date.parse(a.start) - Date.parse(b.start)), [schedule?.assignments, filter]);
  const upcomingAssignments = visibleAssignments.filter(a => future(a.end) && ["pending", "accepted"].includes(a.status));
  const blocks = useMemo(() => (schedule?.blocks ?? []).filter(b => filter === "all" || b.userId === filter).sort((a, b) => a.startLocal.localeCompare(b.startLocal)), [schedule?.blocks, filter]);
  const preferences = useMemo(() => (schedule?.workPreferences ?? []).filter(p => filter === "all" || p.userId === filter), [schedule?.workPreferences, filter]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addLocalDays(`${week}T00:00`, i).slice(0, 10)), [week]);
  function openAssignment(appointmentId = "") {
    setAssignmentAppointmentId(appointmentId);
    setError(""); setAssignmentOpen(true);
  }
  function openBlockTime(id?: string) {
    setError(""); setBlock({ userId: isOwner ? id ?? "" : userId, reason: "", ...initialPeriod(), repeatUntil: "", weekly: false }); setBlockOpen(true);
  }
  useRefreshSource(refreshManually);
  async function removePerson(appointment: TeamAppointment, employeeId: string) {
    return mutate("/rental-staff/remove", { appointmentId: appointment.id, employeeId, start: appointment.start, end: appointment.end });
  }
  const feedback = <>{message && <p role="status" className="schedule-success">{message}</p>}{error && <div role="alert" className="schedule-error"><p>{error}</p><Button disabled={busy} variant="outline" onClick={() => void refreshManually()}>Reload schedule</Button></div>}</>;
  function assignmentCard(item: TeamAssignment, compact = false, onRemove?: () => void) {
    return <AssignmentOffer key={item.id} item={item} compact={compact} onRemove={onRemove} schedule={schedule}
      isHome={isHome} isOwner={isOwner} home={Boolean(home)} busy={busy} needsRefresh={needsRefresh}
      confirm={confirm} setConfirm={setConfirm} error={error} setError={setError} mutate={mutate}
      remindAssignment={remindAssignment} setDetailId={setDetailId} onChecklist={onChecklist} />;
  }

  const activeDetailId = detailId ?? focusId;
  const focusedRentalId = rentalAppointmentId(activeDetailId);
  const focusedItem = focusedRentalId ? undefined : schedule?.assignments.find(item => item.id === activeDetailId);
  const focusedRental = schedule?.appointments.find(item => item.id === (focusedRentalId ?? focusedItem?.appointmentId));
  const detailSource = focusedRental ?? focusedItem;
  const detailEntry = useMemo(() => schedule && detailSource ? (buildScheduleAgenda(schedule, { from: detailSource.start, to: detailSource.end }) as WorkEntry[]).find(item => item.kind === "work" && (focusedRental ? item.appointment?.id === focusedRental.id : item.assignments.some(offer => offer.id === focusedItem?.id))) : undefined, [schedule, detailSource, focusedRental, focusedItem]);
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

    {schedule && <AssignmentDialog open={assignmentOpen} appointmentId={assignmentAppointmentId} schedule={schedule} busy={busy} needsRefresh={needsRefresh} isOwner={isOwner} error={error} mutate={mutate} onClose={() => setAssignmentOpen(false)} />}


    <Dialog open={Boolean(activeDetailId)} onOpenChange={open => { if (!open && !busy) closeDetail(); }}><DialogContent presentation="sheet" closeDisabled={busy} className="schedule-modal appointment-dialog app-task-sheet"><DialogHeader><DialogTitle>{focusedRentalId || focusedRental ? "Appointment details" : "Assignment details"}</DialogTitle><DialogDescription>{focusedRentalId ? "Review the current rental and its team responses." : "Review the current assignment and its response."}</DialogDescription></DialogHeader>
      <div className="app-sheet-scroll">{detailEntry ? <AppointmentDetail item={detailEntry} token={token} userId={userId} isOwner={isOwner} busy={busy} renderAssignment={assignmentCard} onAssign={id => { closeDetail(); openAssignment(id); }} onRemovePerson={removePerson} onPayment={onPayment ? id => { closeDetail(); onPayment(id); } : undefined} feedback={feedback} /> : focusedItem ? assignmentCard(focusedItem) : <p role="status">{loading ? "Loading appointment…" : "This appointment is no longer available to this account."}</p>}</div>
    </DialogContent></Dialog>


  </section>;
}
