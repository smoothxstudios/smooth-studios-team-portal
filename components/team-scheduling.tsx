"use client";
import { AppointmentDetail } from "@/components/appointment-detail";
import { OwnerDailyActions } from "@/components/dashboard/daily-actions";
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
import type { DashboardPayload } from "@/lib/dashboard-types";
import type { TeamAppointment, TeamAssignment } from "@/lib/team-api";
import { useTeamSchedule } from "@/lib/use-team-schedule";
import { studioLocal } from "@/lib/team-schedule.mjs";
import { Clock3 } from "lucide-react";
import { useMemo,useState,type ReactNode } from "react";

import { AssignmentDialog } from "@/components/scheduling/assignment-dialog";
import { AssignmentOffer } from "@/components/scheduling/assignment-offer";
import { date, future, initialPeriod, type ScheduleConfirmationChange } from "@/components/scheduling/shared";

import { EmployeeScheduleToolbar, EmployeeScheduleWeek } from "@/components/scheduling/employee-schedule";

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
    {!isHome && !availabilityOnly && !isOwner && <EmployeeScheduleToolbar view={scheduleTab} onView={setScheduleTab} onAvailability={onAvailability ?? (() => openBlockTime())} />}
    {!isHome && !availabilityOnly && !isOwner && scheduleTab === "past" && <>{pastContent}<article className="schedule-panel"><h3>Past offers & responses</h3>{visibleAssignments.filter(a => !["pending", "accepted"].includes(a.status) || !future(a.end)).length ? <div className="schedule-history employee-past-offers">{visibleAssignments.filter(a => !["pending", "accepted"].includes(a.status) || !future(a.end)).slice(-50).reverse().map(a => <div key={a.id}><span>{date(a.start)} · {a.title}</span><span className="schedule-status">{a.status === "accepted" && a.ownerConfirmation ? "Confirmed by Smooth" : a.status}</span></div>)}</div> : <p className="schedule-empty">{loading ? "Loading past offers…" : "No past offers in this view."}</p>}</article></>}
    {loading && !isHome && <div className="schedule-panel">Loading your schedule…</div>}
    {!loading && enabled === false && <div className="schedule-panel"><h3>Scheduling setup is waiting for deployment</h3><p>{isOwner ? "Your Cloudflare credentials are used securely by GitHub Actions. Activate below to deploy the Worker, prepare the database, and import Calendar. This area opens after all three succeed." : "Smooth is finishing setup. Your existing dashboard is unchanged."}</p>{isOwner && onSetup && <Button className="mt-4" onClick={onSetup}>Activate team scheduling</Button>}</div>}
    {schedule && !isHome && availabilityOnly && <TeamAvailability userId={userId} isOwner={isOwner} schedule={schedule} busy={busy} needsRefresh={needsRefresh} error={error} mutate={mutate} onBlockTime={openBlockTime} />}
    {schedule && !isHome && !availabilityOnly && (isOwner || scheduleTab === "upcoming") && <>
      {isOwner && calendarSync?.status === "needs_access" && <div className="schedule-warning" role="status"><strong>Google Calendar needs permission to show rental assignments</strong><p>In your rental calendar’s Settings and sharing, give <b>{calendarSync.serviceAccountEmail ?? "the existing dashboard service account"}</b> “Make changes to events” access. Rental team notes will appear after the next sync. Your assignments are saved here.</p></div>}
      {isOwner && calendarSync?.status === "retrying" && <p className="schedule-warning" role="status">Some rental team notes could not update in Google Calendar. They will retry on the next sync; your assignments are saved here.</p>}
      {isOwner ? <OwnerScheduleAgenda onOpenWork={openWork} feedback={feedback} onRemovePerson={removePerson} onChecklist={onChecklist} schedule={schedule} employeeId={filter} onEmployeeChange={setFilter} onAssign={openAssignment} onAvailability={onAvailability ?? (() => openBlockTime())} busy={busy} renderAssignment={assignmentCard} /> : <>
      <EmployeeScheduleWeek schedule={schedule} userId={userId} week={week} onWeek={setWeek} onOpen={openWork} />

      <article className="schedule-panel employee-offers-panel"><div className="schedule-section-heading"><h3><Clock3 size={20} />Offers & assignments <span className="schedule-count">{upcomingAssignments.length}</span></h3><p>Accept when you can cover the full time. Contact Smooth for changes.</p></div>
        <div className="schedule-offers">{upcomingAssignments.length ? upcomingAssignments.map(item => assignmentCard(item)) : <p className="schedule-empty">No upcoming portal assignments for this view.</p>}</div>

      </article>

      </>}
    </>}


    <TimeBlockDialog blockOpen={blockOpen} setBlockOpen={setBlockOpen} block={block} setBlock={setBlock} busy={busy} needsRefresh={needsRefresh} isOwner={isOwner} error={error} mutate={mutate} />

    {schedule && <AssignmentDialog open={assignmentOpen} appointmentId={assignmentAppointmentId} schedule={schedule} busy={busy} needsRefresh={needsRefresh} isOwner={isOwner} error={error} mutate={mutate} onClose={() => setAssignmentOpen(false)} />}


    <Dialog open={Boolean(activeDetailId)} onOpenChange={open => { if (!open && !busy) closeDetail(); }}><DialogContent presentation="sheet" data-schedule-live-view="true" closeDisabled={busy} className="schedule-modal appointment-dialog app-task-sheet"><DialogHeader><DialogTitle>{focusedRentalId || focusedRental ? "Appointment details" : "Assignment details"}</DialogTitle><DialogDescription className="sr-only">Review the details and saved responses.</DialogDescription></DialogHeader>
      <div className="app-sheet-scroll">{detailEntry ? <AppointmentDetail item={detailEntry} token={token} userId={userId} isOwner={isOwner} busy={busy} renderAssignment={assignmentCard} onAssign={id => { closeDetail(); openAssignment(id); }} onRemovePerson={removePerson} onPayment={onPayment ? id => { closeDetail(); onPayment(id); } : undefined} feedback={feedback} /> : focusedItem ? <>{feedback}{assignmentCard(focusedItem)}</> : <p role="status">{loading ? "Loading appointment…" : "This appointment is no longer available to this account."}</p>}</div>
    </DialogContent></Dialog>


  </section>;
}
