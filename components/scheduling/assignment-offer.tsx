"use client";
import { useMemo, type Dispatch, type SetStateAction } from "react";
import { Bell, CalendarDays, Check, X } from "lucide-react";
import { PersonAvatar } from "@/components/team-profile";
import { CalendarAssignmentStatus } from "@/components/calendar-assignment-status";
import { RentalDescription } from "@/components/rental-description";
import { ScheduleConfirmation } from "@/components/schedule-confirmation";
import { Button } from "@/components/ui/button";
import { rentalAlertTargetId } from "@/lib/alert-target.mjs";
import { assignmentConflicts, hasConflictOverride } from "@/lib/team-schedule.mjs";
import type { TeamAssignment, TeamSchedule } from "@/lib/team-api";
import { date, time, future, personName, type ScheduleMutation, type ScheduleConfirmationChange } from "./shared";

export function AssignmentOffer({ item, compact = false, onRemove, schedule, isHome, isOwner, home, busy, needsRefresh, confirm, setConfirm, error, setError, mutate, remindAssignment, setDetailId, onChecklist }: {
  item: TeamAssignment; compact?: boolean; onRemove?: () => void; schedule: TeamSchedule | null;
  isHome: boolean; isOwner: boolean; home: boolean; busy: boolean; needsRefresh: boolean;
  confirm: ScheduleConfirmationChange | null; setConfirm: Dispatch<SetStateAction<ScheduleConfirmationChange | null>>;
  error: string; setError: (value: string) => void; mutate: ScheduleMutation;
  remindAssignment: (item: TeamAssignment) => Promise<void>; setDetailId: (id: string | null) => void; onChecklist?: () => void;
}) {
    const pendingChange = confirm?.path === `/assignments/${item.id}` ? confirm : null;
    const action = pendingChange && "status" in pendingChange.data ? pendingChange.data.status : "override";
    const actionLabel = action === "cancelled" ? "Cancel offer" : action === "declined" ? "Decline offer" : "Allow conflict";
    const appointment = useMemo(() => schedule?.appointments.find(a => a.id === item.appointmentId), [schedule?.appointments, item.appointmentId]);
    const busyConflicts = useMemo(() => schedule ? assignmentConflicts(item.employeeId, item, schedule.blocks, schedule.assignments, schedule.appointments, item.id) : [], [schedule, item]);
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
