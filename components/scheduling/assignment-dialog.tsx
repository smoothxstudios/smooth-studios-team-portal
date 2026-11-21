"use client";
import { moneyInputCents } from "@/lib/creative-work.mjs";
import { studioTaskPay } from "@/lib/studio-tasks.mjs";
import { AppSelect } from "@/components/ui/app-controls";
import { IncludeInactive, useTeamRoster } from "@/components/team-roster";
import { useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { MoreOptions } from "@/components/dashboard/more-options";
import { withinStudioHours } from "@/lib/studio-hours.mjs";
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
  const roster = useTeamRoster();
  const [requestId] = useState(() => crypto.randomUUID());
  const [payType, setPayType] = useState("hourly"), [payRate, setPayRate] = useState("");
  const [validation, setValidation] = useState("");
  const [assignment, setAssignment] = useState(() => ({ employeeId: "", appointmentId, title: "", instructions: "", overrideConflicts: false, confirmWorked: false, confirmCompleted: false, confirmedStart: "", confirmedEnd: "", ...initialPeriod() }));
  const appointments = useMemo(() => (schedule?.appointments ?? []).filter(a => future(a.start) || a.id === assignment.appointmentId).sort((a, b) => Date.parse(a.start) - Date.parse(b.start)), [schedule, assignment.appointmentId]);
  const selectedAppointment = appointments.find(a => a.id === assignment.appointmentId);
  const startedRental = Boolean(selectedAppointment && !future(selectedAppointment.start));
  const workConfirmed = assignment.confirmWorked && assignment.confirmedStart === selectedAppointment?.start && assignment.confirmedEnd === selectedAppointment?.end;
  const period = useMemo(() => {
    try { return selectedAppointment ? { ...selectedAppointment, appointmentId: selectedAppointment.id } : assignment.appointmentId ? null : { start: localInstant(assignment.startLocal), end: localInstant(assignment.endLocal) }; }
    catch { return null; }
  }, [selectedAppointment, assignment.appointmentId, assignment.startLocal, assignment.endLocal]);
  const startedTask = Boolean(!assignment.appointmentId && period && !future(period.start));
  const finishedTask = Boolean(startedTask && period && !future(period.end));
  const taskConfirmed = Boolean(startedTask && assignment.confirmWorked && assignment.confirmedStart === period?.start && assignment.confirmedEnd === period?.end && assignment.confirmCompleted === finishedTask);
  const recordingWork = startedRental || startedTask;
  const existingPending = startedRental ? schedule?.assignments.find(a => a.appointmentId === selectedAppointment?.id && a.employeeId === assignment.employeeId && a.status === "pending") : undefined;
  const conflicts = useMemo(() => period ? assignmentConflicts(assignment.employeeId, period, schedule.blocks, schedule.assignments, schedule.appointments, existingPending?.id) : [], [period, schedule, assignment.employeeId, existingPending?.id]);
  const alreadyInvited = selectedAppointment?.acceptedEmployeeIds.includes(assignment.employeeId);
  const alreadyOffered = Boolean(selectedAppointment && schedule?.assignments.some(a => a.appointmentId === selectedAppointment.id && a.employeeId === assignment.employeeId && (a.status === "accepted" || (!startedRental && a.status === "pending"))));
  const selectedPreference = period ? workPreferenceMatch(assignment.employeeId, period, schedule?.workPreferences ?? []) : "none";
  const appointmentOptions = useMemo(() => [{ value: "", label: "Studio Tasks", description: "Schedule a shift without a rental" }, ...appointments.map(a => ({ value: a.id, label: a.customer || a.title, description: `${date(a.start)} · ${time(a.start)}–${time(a.end)} · ${a.title}` }))], [appointments]);
  const employeeOptions = useMemo(() => {
  function employeeAvailabilityLabel(id: string) {
    if (!period || !schedule) return "";
    if (!withinStudioHours(period)) return "Outside studio hours";
    if (assignmentConflicts(id, period, schedule.blocks, schedule.assignments, schedule.appointments).length) return "Time conflict";
    if (!schedule.availabilityVersion) return "Available";
    const match = workPreferenceMatch(id, period, schedule.workPreferences ?? []);
    return match === "full" ? "Wants to work this time" : match === "partial" ? "Partly within preferred hours" : "Available — no conflicts";
  }
    return TEAM.filter(p => p.id !== "owner" && roster?.visible(p.id) !== false && (!schedule.activeEmployeeIds || schedule.activeEmployeeIds.includes(p.id))).map(p => ({ value: p.id, label: p.name, color: p.color, description: period ? employeeAvailabilityLabel(p.id) : undefined }));
  }, [period, schedule, roster]);
  const taskPay = useMemo(() => { try { return period ? studioTaskPay({ type: payType, rateCents: moneyInputCents(payRate) }, period.start, period.end) : null; } catch { return null; } }, [period, payType, payRate]);
  return (
    <><DialogHeader><DialogTitle>{startedTask ? "Record Shift" : startedRental ? "Record rental staff" : assignment.appointmentId ? "Assign Rental" : "Schedule Shift"}</DialogTitle><DialogDescription>{startedTask ? (finishedTask ? "Confirm completed work and add the agreed pay to earnings." : "Record who is working this shift. Add earnings after completion.") : startedRental ? "Confirm who is working or worked this rental." : "They can accept or decline in the app."}</DialogDescription></DialogHeader>
      <form className="app-sheet-form" onSubmit={async e => { e.preventDefault(); setValidation(""); if (!assignment.appointmentId && !taskPay) { setValidation("Choose valid shift times and enter hourly or flat pay."); return; } if (startedTask && !taskConfirmed) { setValidation("Confirm the work at the displayed time before saving."); return; } if (await mutate("/assignments", { ...assignment, ...(!assignment.appointmentId ? { id: requestId, workType: "studio-task", taskPay } : {}) })) onClose(); }}><div className="app-sheet-scroll">
        <AppPicker label="Work Type" value={assignment.appointmentId} disabled={busy} onValueChange={appointmentId => setAssignment({ ...assignment, appointmentId, overrideConflicts: false, confirmWorked: false, confirmCompleted: false, confirmedStart: "", confirmedEnd: "" })} options={appointmentOptions} />
        {selectedAppointment ? <div className="app-booking-summary"><CalendarDays size={20} aria-hidden="true" /><div><strong>{date(selectedAppointment.start)} · {time(selectedAppointment.start)}–{time(selectedAppointment.end)}</strong><small>Rental time and price from Calendar</small></div><b>{money(selectedAppointment.priceCents)}</b></div> : <><label>Shift Title<Input required maxLength={160} value={assignment.title} onChange={e => setAssignment({ ...assignment, title: e.target.value })} placeholder="Clean the studio, organize equipment, prep a set…" /></label><div className="schedule-form-pair"><label>Starts<Input required type="datetime-local" value={assignment.startLocal} onChange={e => setAssignment({ ...assignment, startLocal: e.target.value, overrideConflicts: false, confirmWorked: false, confirmCompleted: false, confirmedStart: "", confirmedEnd: "" })} /></label><label>Ends<Input required type="datetime-local" value={assignment.endLocal} onChange={e => setAssignment({ ...assignment, endLocal: e.target.value, overrideConflicts: false, confirmWorked: false, confirmCompleted: false, confirmedStart: "", confirmedEnd: "" })} /></label></div></>}
        {!assignment.appointmentId && <><div className="schedule-form-pair"><label>Pay type<AppSelect value={payType} onValueChange={value => { setPayType(value); setAssignment({ ...assignment, confirmWorked: false }); }}><option value="hourly">Hourly</option><option value="flat">Flat Amount</option></AppSelect></label><label>{payType === "hourly" ? "Hourly rate (USD)" : "Shift pay (USD)"}<Input required inputMode="decimal" value={payRate} onChange={event => { setPayRate(event.target.value); setAssignment({ ...assignment, confirmWorked: false }); }} placeholder="0.00" /></label></div>{taskPay && <p className="schedule-notice"><strong>{money(taskPay.amountCents)} total shift pay</strong> · {finishedTask ? "Added to earnings when you confirm and save this completed shift." : "Added to earnings after Smooth confirms completion."}</p>}<label>Tasks<Textarea required maxLength={2000} rows={3} value={assignment.instructions} onChange={event => setAssignment({ ...assignment, instructions: event.target.value })} placeholder="List what needs to be done during this shift." /></label></>}
        <IncludeInactive />
        <AppPicker label="Employee" required placeholder="Choose a person" value={assignment.employeeId} disabled={busy} onValueChange={employeeId => setAssignment({ ...assignment, employeeId, overrideConflicts: false, confirmWorked: false, confirmCompleted: false, confirmedStart: "", confirmedEnd: "" })} options={employeeOptions} />
        {!recordingWork && !assignment.employeeId && period && schedule && <details className="offer-suggestions"><summary>Suggested people</summary><RentalSuggestions period={period} schedule={schedule} busy={busy || needsRefresh} onChoose={id => setAssignment({ ...assignment, employeeId: id, overrideConflicts: false, confirmWorked: false, confirmCompleted: false, confirmedStart: "", confirmedEnd: "" })} /></details>}
        {!recordingWork && assignment.employeeId && period && withinStudioHours(period) && schedule?.availabilityVersion === 1 && !conflicts.length && <p className={selectedPreference === "full" ? "schedule-success" : "schedule-notice"}>{selectedPreference === "full" ? `${personName(assignment.employeeId)} prefers this time. Acceptance is still required.` : selectedPreference === "partial" ? "Partly outside their preferred hours. They can still accept." : "Available for this time. They still need to accept."}</p>}
        {(conflicts.length > 0 || alreadyInvited || alreadyOffered) && <p className="schedule-warning">{alreadyInvited ? "This person already accepted the Calendar invitation." : alreadyOffered ? "This person already has an active offer for this appointment." : conflicts.join("; ")}</p>}
        {isOwner && conflicts.length > 0 && !alreadyInvited && !alreadyOffered && <ConfirmationRow tone="warning" checked={assignment.overrideConflicts} disabled={busy} onCheckedChange={overrideConflicts => setAssignment({ ...assignment, overrideConflicts })}>{recordingWork ? "Allow this time conflict for the work I am confirming." : "Allow this time conflict. The employee still needs to accept."}</ConfirmationRow>}
        {startedTask && period && assignment.employeeId && <ConfirmationRow checked={taskConfirmed} disabled={busy} onCheckedChange={confirmWorked => setAssignment({ ...assignment, confirmWorked, confirmCompleted: finishedTask, confirmedStart: period.start, confirmedEnd: period.end })} description={finishedTask ? `Adds ${money(taskPay?.amountCents ?? 0)} to earnings. Record payment separately.` : "Confirm completion after the shift ends to add earnings."}>I confirm {personName(assignment.employeeId)} {finishedTask ? "completed" : "is working"} this shift at the displayed time.</ConfirmationRow>}
        {startedRental && selectedAppointment && assignment.employeeId && <ConfirmationRow checked={workConfirmed} disabled={busy} onCheckedChange={confirmWorked => setAssignment({ ...assignment, confirmWorked, confirmedStart: selectedAppointment.start, confirmedEnd: selectedAppointment.end })} description="Counts toward rental hours and earnings under the existing payment rules.">I confirm {personName(assignment.employeeId)} {future(selectedAppointment.end) ? "is working" : "worked"} this rental at the displayed time.</ConfirmationRow>}
        {assignment.appointmentId && <MoreOptions><label>Instructions (optional)<Textarea maxLength={2000} rows={3} value={assignment.instructions} onChange={e => setAssignment({ ...assignment, instructions: e.target.value })} placeholder="Arrival instructions, responsibilities, anything to prepare…" /></label></MoreOptions>}
        {assignment.employeeId && <p className="schedule-small">{recordingWork ? "Saved as Confirmed by Smooth. This does not record a payment." : schedule?.devices[assignment.employeeId] ? `${personName(assignment.employeeId)} will be notified in the app and on enabled devices.` : `${personName(assignment.employeeId)} can view and accept this in the app. Device alerts are off.`}</p>}
        {(error || validation) && <p className="schedule-error" role="alert">{validation || error}</p>}
        </div><DialogFooter><Button disabled={busy} type="button" variant="outline" onClick={() => onClose()}>Cancel</Button><Button disabled={busy || needsRefresh || !assignment.employeeId || (!assignment.appointmentId && !taskPay) || (conflicts.length > 0 && !assignment.overrideConflicts) || alreadyInvited || alreadyOffered || !period || (startedRental && !workConfirmed) || (startedTask && !taskConfirmed)} type="submit">{busy ? "Saving…" : error ? "Try again" : startedTask ? (finishedTask ? "Record & Add Pay" : "Record Shift") : startedRental ? "Record person" : assignment.appointmentId ? "Send offer" : "Schedule Shift"}</Button></DialogFooter>
      </form></>
  );
}
