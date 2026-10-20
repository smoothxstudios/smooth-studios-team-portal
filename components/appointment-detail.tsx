"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RentalDescription } from "@/components/rental-description";
import { PersonLabel } from "@/components/dashboard/person-label";
import { ScheduleConfirmation } from "@/components/schedule-confirmation";
import { CalendarAssignmentStatus } from "@/components/calendar-assignment-status";
import { teamRequest, type TeamAssignment, type TeamAppointment } from "@/lib/team-api";
import type { WorkEntry } from "@/lib/schedule-calendar-types";
import { assignmentResponseLabel } from "@/lib/calendar-invitations.mjs";
import { appointmentBalance } from "@/lib/daily-actions.mjs";
import { formatDate, formatTime, dollars } from "@/lib/dashboard-presentation";

type Step = { id: string; phase: string; label: string };
type Progress = { version: number; checked: Record<string, { by: string; at: string }>; note: string };
type ChecklistRental = { id: string; checklistId: string; progress: Progress };
function AppointmentChecklist({ token, appointmentId }: { token: string; userId: string; appointmentId: string }) {
  const [steps, setSteps] = useState<Step[] | null>(null), [rental, setRental] = useState<ChecklistRental | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [retry, setRetry] = useState<{ id: string; checked: boolean } | null>(null);
  const saving = useRef(false);
  const load = useCallback(async () => {
    const result = await teamRequest<{ template: Step[]; rentals: ChecklistRental[] }>(token, "/rental-checklists");
    const current = result.rentals.find(item => item.id === appointmentId) ?? null;
    setSteps(result.template); setRental(current); return current;
  }, [token, appointmentId]);
  const reload = async () => { setBusy(true); try { await load(); setError(""); } catch { setError("Checklist couldn’t load. Check your connection and try again."); } finally { setBusy(false); } };
  useEffect(() => { let active = true; void load().catch(() => { if (active) setError("Checklist couldn’t load. Check your connection and try again."); }); return () => { active = false; }; }, [load]);
  const save = async (id: string, checked: boolean, refreshing = false) => {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError("");
    try {
      const current = refreshing ? await load() : rental;
      if (!current) throw new Error("Accept this rental before updating its checklist.");
      if (Boolean(current.progress.checked[id]) !== checked) {
        const result = await teamRequest<{ progress: Progress }>(token, `/rental-checklists/${current.checklistId}`, { action: "check", itemId: id, checked, version: current.progress.version }, "PATCH");
        setRental({ ...current, progress: result.progress });
      }
      setRetry(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The step could not be saved."); setRetry({ id, checked }); }
    finally { saving.current = false; setBusy(false); }
  };
  return <section className="appointment-checklist"><div className="appointment-section-heading"><h3>Rental checklist</h3>{steps && <span role="status">{busy ? "Saving…" : `${steps.filter(step => rental?.progress.checked[step.id]).length}/${steps.length} done`}</span>}</div><p className="schedule-small">{rental ? "Shared with the crew for this rental. Each check is saved." : "Accept the rental to update its shared checklist."}</p>
    {error && <p role="alert">{error} <Button disabled={busy} variant="outline" onClick={() => retry ? void save(retry.id, retry.checked, true) : void reload()}>Try again</Button></p>}
    {!steps && !error ? <p role="status">Loading checklist…</p> : steps && [...new Set(steps.map(step => step.phase))].map(phase => <fieldset key={phase}><legend>{phase}</legend>{steps.filter(step => step.phase === phase).map(step => <label key={step.id}><input type="checkbox" disabled={busy || !rental || Boolean(retry)} checked={Boolean(rental?.progress.checked[step.id])} onChange={event => void save(step.id, event.target.checked)} /><span>{step.label}{rental?.progress.checked[step.id] && <small>Completed by <PersonLabel id={rental.progress.checked[step.id].by} /></small>}</span></label>)}</fieldset>)}
  </section>;
}

export function AppointmentDetail({ item, token, userId, isOwner, busy, renderAssignment, onAssign, onRemovePerson, onPayment, feedback }: {
  item: WorkEntry; token: string; userId: string; isOwner: boolean; busy: boolean;
  renderAssignment: (item: TeamAssignment, compact?: boolean) => ReactNode;
  onAssign: (id: string) => void; onRemovePerson: (appointment: TeamAppointment, id: string) => Promise<boolean>;
  onPayment?: (id: string) => void; feedback: ReactNode;
}) {
  const [removing, setRemoving] = useState<string | null>(null);
  const appointment = item.appointment;
  const balance = appointment ? appointmentBalance(appointment) : null;
  const live = item.assignments.filter(offer => ["pending", "accepted"].includes(offer.status));
  const previous = item.assignments.filter(offer => !["pending", "accepted"].includes(offer.status));
  return <div className="appointment-detail">
    <header><h2>{item.customer || item.title}</h2>{item.customer && <p>{item.title}</p>}<p>{formatDate(item.start)} · {formatTime(item.start)}–{formatTime(item.end)}{formatDate(item.start) !== formatDate(item.end) ? ` · ends ${formatDate(item.end)}` : ""}</p></header>
    <div className="schedule-dialog-feedback">{feedback}</div>
    {appointment && <section><h3>Rental details</h3><RentalDescription details={appointment.rentalDetails} showHeading={false} />
      <dl className="appointment-balance"><div><dt>Rental price</dt><dd>{dollars(appointment.priceCents, true)}</dd></div><div><dt>{isOwner ? balance!.label : "Customer balance"}</dt><dd>{!isOwner ? "Confirm with Smooth" : balance!.remaining === null ? "Unconfirmed" : dollars(balance!.remaining, true)}</dd></div></dl>
      {isOwner && onPayment && !appointment.fullyPaid && <Button variant="outline" onClick={() => onPayment(appointment.id)}>Review payment</Button>}
    </section>}
    <section><div className="appointment-section-heading"><h3>Assigned people</h3>{isOwner && appointment && Date.parse(item.start) > Date.now() && <Button disabled={busy} variant="outline" onClick={() => onAssign(appointment.id)}><Plus size={16} />{item.confirmations.length ? "Add person" : "Assign person"}</Button>}</div>
      {!item.confirmations.length && <p className="schedule-small">No one is assigned yet.</p>}
      {!isOwner && item.pendingIds.includes(userId) && !live.some(offer => offer.employeeId === userId) && <p className="schedule-notice">Respond to this invitation in Google Calendar to accept or decline.</p>}<ul className="appointment-people">{item.confirmations.map(person => <li key={person.employeeId}><span><PersonLabel id={person.employeeId} /><small>{assignmentResponseLabel(person)}</small></span>{(person.appStatus === "accepted" || person.calendarAccepted) && <Check size={17} aria-label="Accepted" />}{isOwner && appointment && Date.parse(item.start) > Date.now() && <Button variant="ghost" disabled={busy} onClick={() => setRemoving(person.employeeId)} aria-label={`Remove ${person.employeeId} from rental`}>Remove</Button>}</li>)}</ul>
      {removing && appointment && <ScheduleConfirmation label="Remove person from rental"><p>Remove <PersonLabel id={removing} /> from this rental? Their app offers will be cancelled and their Calendar invitation removed when connected.</p><div className="schedule-actions"><Button variant="outline" disabled={busy} onClick={() => setRemoving(null)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={async () => { if (await onRemovePerson(appointment, removing)) setRemoving(null); }}>{busy ? "Removing…" : "Remove person"}</Button></div></ScheduleConfirmation>}
      <div className="appointment-offers">{live.map(offer => renderAssignment(offer, true))}</div>
      {previous.length > 0 && <details className="appointment-history"><summary>Previous responses ({previous.length})</summary>{previous.map(offer => <div key={offer.id}><PersonLabel id={offer.employeeId} /><span className={`schedule-status ${offer.status}`}>{offer.status === "cancelled" ? "Offer cancelled" : "Declined"}</span><CalendarAssignmentStatus delivery={offer.calendarSync} /></div>)}</details>}
    </section>
    {appointment && /rental/i.test(item.title) && <AppointmentChecklist key={`${userId}:${appointment.id}:${item.confirmations.find(person => person.employeeId === userId)?.appStatus ?? "calendar"}`} token={token} userId={userId} appointmentId={appointment.id} />}
  </div>;
}
