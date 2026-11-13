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
import { unapprovedAssignmentConflicts } from "@/lib/assignment-conflict-review.mjs";
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
    const blockingConflicts = useMemo(() => schedule ? unapprovedAssignmentConflicts(item.employeeId, item, schedule.blocks, schedule.assignments, schedule.appointments, item.id) : [], [schedule, item]);
    const conflictApproved = hasConflictOverride(item) || (busyConflicts.length > 0 && blockingConflicts.length === 0);
    return <article className={`schedule-offer${compact ? "" : " offer-full"}`} key={item.id}>
      <div className="offer-overview"><div className="schedule-row">{(!isHome || isOwner) && <span className="offer-person"><PersonAvatar personId={item.employeeId} /><strong>{personName(item.employeeId)}</strong></span>}<span className={`schedule-status ${item.status}`}>{item.status === "pending" && !future(item.start) ? "Needs Smooth’s review" : !isOwner && item.status === "pending" ? "Awaiting your response" : item.status === "accepted" && item.ownerConfirmation ? "Confirmed by Smooth" : item.status === "pending" ? "Awaiting response" : item.status === "accepted" ? "Accepted in app" : item.status}</span></div>
      {!compact && <h3>{appointment?.customer || appointment?.title || item.title}</h3>}
      {!compact && appointment?.customer && <p className="offer-rental-title">{appointment.title}</p>}
      {!compact && <p className="offer-time"><CalendarDays size={15} /> {date(item.start)} · {time(item.start)}–{time(item.end)}</p>}
      {!compact && (!home || !item.appointmentId) && <p className="schedule-small">{item.appointmentId ? "Rental assignment" : "Custom assignment · confirm pay with Smooth"}</p>}
      {!compact && !home && appointment && /studio.*rental|rental.*studio/i.test(appointment.title) && <RentalDescription details={appointment.rentalDetails} />}
      {item.instructions && <p className="schedule-instructions">{item.instructions}</p>}
      {item.note && <p className="schedule-notice">{item.note}</p>}
      {item.status === "accepted" && <p className="offer-saved-response"><Check size={15} aria-hidden="true" />{item.ownerConfirmation ? "Recorded by Smooth." : isOwner ? "Response saved. No further acceptance needed." : "You’re confirmed. No need to accept again."}</p>}
      {busyConflicts.length > 0 && <details className={`offer-conflict ${conflictApproved ? "is-approved" : "needs-review"}`}><summary>{conflictApproved ? "Time conflict approved by Smooth" : "Time conflict needs review"}</summary><p>{(conflictApproved ? busyConflicts : blockingConflicts).join("; ")}</p>{!conflictApproved && <p>{isOwner ? "Approve the overlap below." : "Ask Smooth to approve this overlap. This view updates automatically."}</p>}</details>}
      </div><div className="offer-response"><div className="schedule-actions">
        {!compact && item.appointmentId && <Button variant="outline" onClick={() => setDetailId(rentalAlertTargetId(item.appointmentId!))}>Details</Button>}
        {isOwner && item.status === "pending" && future(item.start) && <Button disabled={busy || needsRefresh} variant="outline" onClick={() => void remindAssignment(item)}><Bell size={16} />{busy ? "Sending…" : "Remind"}</Button>}
        {!compact && onChecklist && item.appointmentId && item.status === "accepted" && /studio.*rental|rental.*studio/i.test(item.title) && <Button variant="outline" onClick={() => setDetailId(rentalAlertTargetId(item.appointmentId!))}>Open rental & checklist</Button>}
        {!isOwner && item.status === "pending" && future(item.start) && <>
          <Button disabled={busy || needsRefresh || (blockingConflicts.length > 0)} onClick={() => void mutate(`/assignments/${item.id}`, { status: "accepted" })}><Check size={16} />{busy ? "Saving…" : item.appointmentId ? "Accept rental" : "Accept assignment"}</Button>
          <Button disabled={busy || needsRefresh} variant="outline" onClick={() => setConfirm({ path: `/assignments/${item.id}`, method: "POST", data: { status: "declined" }, description: `Decline ${item.title} on ${date(item.start)}? Smooth will see your response.` })}><X size={16} />Decline</Button>
        </>}
        {isOwner && ["pending", "accepted"].includes(item.status) && future(item.start) && busyConflicts.length > 0 && !conflictApproved && <Button disabled={busy || needsRefresh} variant="outline" onClick={() => setConfirm({ path: `/assignments/${item.id}`, method: "POST", data: { overrideConflicts: true }, description: `Allow ${personName(item.employeeId)} to accept ${item.title} despite the recorded conflicts for ${date(item.start)} at ${time(item.start)}? Their acceptance is still required. Changing the appointment time clears this approval.` })}>Allow time conflict</Button>}
        {isOwner && onRemove && future(item.start) && <Button disabled={busy || needsRefresh} variant="ghost" onClick={onRemove}>Remove person</Button>}
        {isOwner && !onRemove && ["pending", "accepted"].includes(item.status) && future(item.start) && <Button disabled={busy || needsRefresh} variant="outline" haptic="light" onClick={() => { setError(""); setConfirm({ path: `/assignments/${item.id}`, method: "POST", data: { status: "cancelled" }, description: `Cancel ${personName(item.employeeId)}’s app offer for ${item.title}? The app will also remove an invitation it created. Invitations added separately in Google Calendar stay available. Use Remove person to remove them from the rental completely.` }); }}>Cancel offer</Button>}
      </div>
      {item.calendarSync && <details className="offer-calendar-status"><summary>Calendar sync</summary><CalendarAssignmentStatus delivery={item.calendarSync} /><p className="schedule-small">App responses save separately.</p></details>}
      </div>
      {pendingChange && <ScheduleConfirmation>
        <p>{pendingChange.description}</p>
        {error && <p className="schedule-error" role="alert">{error}</p>}
        <div className="schedule-actions"><Button disabled={busy} variant="outline" onClick={() => setConfirm(null)}>Cancel</Button><Button variant={action === "override" ? "default" : "destructive"} disabled={busy || needsRefresh} aria-busy={busy} onClick={async () => { if (await mutate(pendingChange.path, pendingChange.data, pendingChange.method)) setConfirm(null); }}>{busy ? action === "cancelled" ? "Cancelling…" : "Saving…" : actionLabel}</Button></div>
      </ScheduleConfirmation>}
    </article>;
}
