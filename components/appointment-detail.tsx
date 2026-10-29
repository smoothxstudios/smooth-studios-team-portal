"use client";

import { useState, type ReactNode } from "react";
import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RentalDescription } from "@/components/rental-description";
import { PersonLabel } from "@/components/dashboard/person-label";
import { ScheduleConfirmation } from "@/components/schedule-confirmation";
import { AppleCalendarSettings } from "@/components/apple-calendar-settings";
import { CalendarAssignmentStatus } from "@/components/calendar-assignment-status";
import { type TeamAssignment, type TeamAppointment } from "@/lib/team-api";
import type { WorkEntry } from "@/lib/schedule-calendar-types";
import { assignmentResponseLabel } from "@/lib/calendar-invitations.mjs";
import { appointmentBalance } from "@/lib/daily-actions.mjs";
import { formatDate, formatTime, dollars } from "@/lib/dashboard-presentation";


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
    <AppleCalendarSettings key={userId} token={token} isOwner={isOwner} compact />
    <div className="schedule-dialog-feedback">{feedback}</div>
    {appointment && <section><h3>Rental details</h3><RentalDescription details={appointment.rentalDetails} showHeading={false} />
      <dl className="appointment-balance"><div><dt>Rental price</dt><dd>{dollars(appointment.priceCents, true)}</dd></div><div><dt>{balance!.label}</dt><dd>{balance!.remaining === null ? (isOwner ? "Unconfirmed" : "Confirm with Smooth") : dollars(balance!.remaining, true)}</dd></div></dl>
      {isOwner && onPayment && !appointment.fullyPaid && <Button variant="outline" onClick={() => onPayment(appointment.id)}>Review payment</Button>}
    </section>}
    <section><div className="appointment-section-heading"><h3>Assigned people</h3>{isOwner && appointment && Date.parse(item.start) > Date.now() && <Button disabled={busy} variant="outline" onClick={() => onAssign(appointment.id)}><Plus size={16} />{item.confirmations.length ? "Add person" : "Assign person"}</Button>}</div>
      {!item.confirmations.length && <p className="schedule-small">No one is assigned yet.</p>}
      {!isOwner && item.pendingIds.includes(userId) && !live.some(offer => offer.employeeId === userId) && <p className="schedule-notice">Respond to this invitation in Google Calendar to accept or decline.</p>}<ul className="appointment-people">{item.confirmations.map(person => <li key={person.employeeId}><span><PersonLabel id={person.employeeId} /><small>{assignmentResponseLabel(person)}</small></span>{(person.appStatus === "accepted" || person.calendarAccepted) && <Check size={17} aria-label="Accepted" />}{isOwner && appointment && Date.parse(item.start) > Date.now() && <Button variant="ghost" disabled={busy} onClick={() => setRemoving(person.employeeId)} aria-label={`Remove ${person.employeeId} from rental`}>Remove</Button>}</li>)}</ul>
      {removing && appointment && <ScheduleConfirmation label="Remove person from rental"><p>Remove <PersonLabel id={removing} /> from this rental? Their app offers will be cancelled and their Calendar invitation removed when connected.</p><div className="schedule-actions"><Button variant="outline" disabled={busy} onClick={() => setRemoving(null)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={async () => { if (await onRemovePerson(appointment, removing)) setRemoving(null); }}>{busy ? "Removing…" : "Remove person"}</Button></div></ScheduleConfirmation>}
      <div className="appointment-offers">{live.map(offer => renderAssignment(offer, true))}</div>
      {previous.length > 0 && <details className="appointment-history"><summary>Previous responses ({previous.length})</summary>{previous.map(offer => <div key={offer.id}><PersonLabel id={offer.employeeId} /><span className={`schedule-status ${offer.status}`}>{offer.status === "cancelled" ? "Offer cancelled" : "Declined"}</span><CalendarAssignmentStatus delivery={offer.calendarSync} /></div>)}</details>}
    </section>
  </div>;
}
