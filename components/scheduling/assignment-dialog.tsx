"use client";
import { useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { MoreOptions } from "@/components/dashboard/more-options";
import { RentalSuggestions } from "@/components/rental-suggestions";
import { AppPicker, ConfirmationRow } from "@/components/ui/app-controls";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { assignmentConflicts, localInstant, TEAM, workPreferenceMatch } from "@/lib/team-schedule.mjs";
import type { TeamSchedule } from "@/lib/team-api";
import { date, time, money, future, personName, initialPeriod, type ScheduleMutation } from "./shared";

type AssignmentDialogProps = {
  open: boolean; appointmentId: string; schedule: TeamSchedule; busy: boolean; needsRefresh: boolean;
  isOwner: boolean; error: string; mutate: ScheduleMutation; onClose: () => void;
};

export function AssignmentDialog({ open, ...props }: AssignmentDialogProps) {
  return <Dialog open={open} onOpenChange={value => { if (!value && !props.busy) props.onClose(); }}>
    <DialogContent presentation="sheet" closeDisabled={props.busy} className="schedule-modal assignment-dialog app-task-sheet">
      <AssignmentForm {...props} />
    </DialogContent>
  </Dialog>;
}

// Radix mounts this only while the sheet is present, and retains it for its exit.
function AssignmentForm({ appointmentId, schedule, busy, needsRefresh, isOwner, error, mutate, onClose }: Omit<AssignmentDialogProps, "open">) {
  const [assignment, setAssignment] = useState(() => ({ employeeId: "", appointmentId, title: "", instructions: "", overrideConflicts: false, confirmWorked: false, confirmedStart: "", confirmedEnd: "", ...initialPeriod() }));
  const appointments = useMemo(() => (schedule?.appointments ?? []).filter(a => future(a.start) || a.id === assignment.appointmentId).sort((a, b) => Date.parse(a.start) - Date.parse(b.start)), [schedule, assignment.appointmentId]);
  const selectedAppointment = appointments.find(a => a.id === assignment.appointmentId);
  const startedRental = Boolean(selectedAppointment && !future(selectedAppointment.start));
  const workConfirmed = assignment.confirmWorked && assignment.confirmedStart === selectedAppointment?.start && assignment.confirmedEnd === selectedAppointment?.end;
  const period = useMemo(() => {
    try { return selectedAppointment ? { ...selectedAppointment, appointmentId: selectedAppointment.id } : assignment.appointmentId ? null : { start: localInstant(assignment.startLocal), end: localInstant(assignment.endLocal) }; }
    catch { return null; }
  }, [selectedAppointment, assignment.appointmentId, assignment.startLocal, assignment.endLocal]);
  const existingPending = startedRental ? schedule?.assignments.find(a => a.appointmentId === selectedAppointment?.id && a.employeeId === assignment.employeeId && a.status === "pending") : undefined;
  const conflicts = useMemo(() => period ? assignmentConflicts(assignment.employeeId, period, schedule.blocks, schedule.assignments, schedule.appointments, existingPending?.id) : [], [period, schedule, assignment.employeeId, existingPending?.id]);
  const alreadyInvited = selectedAppointment?.acceptedEmployeeIds.includes(assignment.employeeId);
  const alreadyOffered = Boolean(selectedAppointment && schedule?.assignments.some(a => a.appointmentId === selectedAppointment.id && a.employeeId === assignment.employeeId && (a.status === "accepted" || (!startedRental && a.status === "pending"))));
  const selectedPreference = period ? workPreferenceMatch(assignment.employeeId, period, schedule?.workPreferences ?? []) : "none";
  const appointmentOptions = useMemo(() => [{ value: "", label: "Custom assignment", description: "No automatic commission" }, ...appointments.map(a => ({ value: a.id, label: a.customer || a.title, description: `${date(a.start)} · ${time(a.start)}–${time(a.end)} · ${a.title}` }))], [appointments]);
  const employeeOptions = useMemo(() => {
  function employeeAvailabilityLabel(id: string) {
    if (!period || !schedule) return "";
    if (assignmentConflicts(id, period, schedule.blocks, schedule.assignments, schedule.appointments).length) return "Time conflict";
    if (!schedule.availabilityVersion) return "No recorded conflict";
    const match = workPreferenceMatch(id, period, schedule.workPreferences ?? []);
    return match === "full" ? "Wants to work this time" : match === "partial" ? "Partly within preferred hours" : "No preference recorded";
  }
    return TEAM.filter(p => p.id !== "owner").map(p => ({ value: p.id, label: p.name, color: p.color, description: period ? employeeAvailabilityLabel(p.id) : undefined }));
  }, [period, schedule]);
  return (
    <><DialogHeader><DialogTitle>{startedRental ? "Record rental staff" : "Assign work"}</DialogTitle><DialogDescription>{startedRental ? "Confirm who is working or worked this rental." : "They can accept or decline in the app."}</DialogDescription></DialogHeader>
      <form className="app-sheet-form" onSubmit={async e => { e.preventDefault(); if (await mutate("/assignments", assignment)) onClose(); }}><div className="app-sheet-scroll">
        <AppPicker label="Rental or assignment" value={assignment.appointmentId} disabled={busy} onValueChange={appointmentId => setAssignment({ ...assignment, appointmentId, overrideConflicts: false, confirmWorked: false, confirmedStart: "", confirmedEnd: "" })} options={appointmentOptions} />
        {selectedAppointment ? <div className="app-booking-summary"><CalendarDays size={20} aria-hidden="true" /><div><strong>{date(selectedAppointment.start)} · {time(selectedAppointment.start)}–{time(selectedAppointment.end)}</strong><small>Rental time and price from Calendar</small></div><b>{money(selectedAppointment.priceCents)}</b></div> : <><label>Assignment title<Input required maxLength={160} value={assignment.title} onChange={e => setAssignment({ ...assignment, title: e.target.value })} placeholder="Prepare the studio, assist on location…" /></label><div className="schedule-form-pair"><label>Starts<Input required type="datetime-local" value={assignment.startLocal} onChange={e => setAssignment({ ...assignment, startLocal: e.target.value, overrideConflicts: false, confirmWorked: false, confirmedStart: "", confirmedEnd: "" })} /></label><label>Ends<Input required type="datetime-local" value={assignment.endLocal} onChange={e => setAssignment({ ...assignment, endLocal: e.target.value, overrideConflicts: false, confirmWorked: false, confirmedStart: "", confirmedEnd: "" })} /></label></div></>}
        <AppPicker label="Employee" required placeholder="Choose a person" value={assignment.employeeId} disabled={busy} onValueChange={employeeId => setAssignment({ ...assignment, employeeId, overrideConflicts: false, confirmWorked: false, confirmedStart: "", confirmedEnd: "" })} options={employeeOptions} />
        {!startedRental && !assignment.employeeId && period && schedule && <details className="offer-suggestions"><summary>Suggested people</summary><RentalSuggestions period={period} schedule={schedule} busy={busy || needsRefresh} onChoose={id => setAssignment({ ...assignment, employeeId: id, overrideConflicts: false, confirmWorked: false, confirmedStart: "", confirmedEnd: "" })} /></details>}
        {!startedRental && assignment.employeeId && period && schedule?.availabilityVersion === 1 && !conflicts.length && <p className={selectedPreference === "full" ? "schedule-success" : "schedule-notice"}>{selectedPreference === "full" ? `${personName(assignment.employeeId)} prefers this time. Acceptance is still required.` : selectedPreference === "partial" ? "Partly outside their preferred hours. They can still accept." : "No preference recorded. You can still send an offer."}</p>}
        {(conflicts.length > 0 || alreadyInvited || alreadyOffered) && <p className="schedule-warning">{alreadyInvited ? "This person already accepted the Calendar invitation." : alreadyOffered ? "This person already has an active offer for this appointment." : conflicts.join("; ")}</p>}
        {isOwner && conflicts.length > 0 && !alreadyInvited && !alreadyOffered && <ConfirmationRow tone="warning" checked={assignment.overrideConflicts} disabled={busy} onCheckedChange={overrideConflicts => setAssignment({ ...assignment, overrideConflicts })}>{startedRental ? "Allow this time conflict for the work I am confirming." : "Allow this time conflict. The employee still needs to accept."}</ConfirmationRow>}
        {startedRental && selectedAppointment && assignment.employeeId && <ConfirmationRow checked={workConfirmed} disabled={busy} onCheckedChange={confirmWorked => setAssignment({ ...assignment, confirmWorked, confirmedStart: selectedAppointment.start, confirmedEnd: selectedAppointment.end })} description="Counts toward rental hours and earnings under the existing payment rules.">I confirm {personName(assignment.employeeId)} {future(selectedAppointment.end) ? "is working" : "worked"} this rental at the displayed time.</ConfirmationRow>}
        <MoreOptions><label>Instructions (optional)<Textarea maxLength={2000} rows={3} value={assignment.instructions} onChange={e => setAssignment({ ...assignment, instructions: e.target.value })} placeholder="Arrival instructions, responsibilities, anything to prepare…" /></label></MoreOptions>
        {assignment.employeeId && <p className="schedule-small">{startedRental ? "Saved as Confirmed by Smooth. This does not record a payment." : schedule?.devices[assignment.employeeId] ? `${personName(assignment.employeeId)} will be notified in the app and on enabled devices.` : `${personName(assignment.employeeId)} can view and accept this in the app. Device alerts are off.`}</p>}
        {error && <p className="schedule-error" role="alert">{error}</p>}
        </div><DialogFooter><Button disabled={busy} type="button" variant="outline" onClick={() => onClose()}>Cancel</Button><Button disabled={busy || needsRefresh || !assignment.employeeId || (conflicts.length > 0 && !assignment.overrideConflicts) || alreadyInvited || alreadyOffered || !period || (startedRental && !workConfirmed)} type="submit">{busy ? "Saving…" : error ? "Try again" : startedRental ? "Record person" : "Send offer"}</Button></DialogFooter>
      </form></>
  );
}
