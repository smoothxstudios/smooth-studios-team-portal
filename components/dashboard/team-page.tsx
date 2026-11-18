"use client";

import { IncludeInactive, useTeamRoster } from "@/components/team-roster";
import { PersonAvatar } from "@/components/team-profile";
import { TeamNotifications } from "@/components/team-notifications";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { creativeEarnings } from "@/lib/creative-work.mjs";
import { dollars, formatDate, paidEarnings, rentalState, unpaidEarnings } from "@/lib/dashboard-presentation";
import type { Employee, PayrollState, Rental } from "@/lib/dashboard-types";
import type { CreativeAssignment } from "@/lib/use-creative-work";
import { CalendarDays } from "lucide-react";
import { useState } from "react";

function RentalDeductionStart({ employee }: { employee: Employee }) {
  const roster = useTeamRoster();
  const member = roster?.members.find(person => person.id === employee.id);
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState("");
  const unavailable = !member || roster?.loading || roster?.busy || Boolean(roster?.error);
  return <div className="team-rental-start">
    <div className="team-rental-start-heading"><span>Rental deduction start</span>
      <Button size="sm" variant="ghost" disabled={unavailable} aria-label={`Edit rental deduction start for ${employee.name}`}
        onClick={() => { setDraft(member?.rentalDeductionStart ?? ""); setEditing(true); }}>Edit</Button></div>
    {!editing ? <p>{member?.rentalDeductionStart ? formatDate(`${member.rentalDeductionStart}T12:00:00Z`) : "Studio cutoff · Sep 25, 2026"}</p> :
      <form onSubmit={async event => { event.preventDefault(); if (await roster?.setRentalDeductionStart(employee.id, draft || null)) setEditing(false); }}>
        <label htmlFor={`rental-start-${employee.id}`}>Team start date</label>
        <input id={`rental-start-${employee.id}`} type="date" value={draft} disabled={roster?.busy}
          aria-describedby={`rental-start-help-${employee.id}`} onChange={event => setDraft(event.target.value)} />
        <p id={`rental-start-help-${employee.id}`}>Earlier rentals are excluded from pay deductions. Blank uses the studio cutoff. Saved payment receipts stay intact.</p>
        <div className="team-rental-start-actions"><Button size="sm" variant="outline" type="button" disabled={roster?.busy} onClick={() => setEditing(false)}>Cancel</Button>
          <Button size="sm" type="submit" disabled={unavailable}>{roster?.busy ? "Saving…" : "Save date"}</Button></div>
      </form>}
  </div>;
}

type TeamPageProps = {
  employees: Employee[];
  rentals: Rental[];
  creative: CreativeAssignment[];
  payroll?: PayrollState;
  onSetup: () => void;
  token?: string;
};

type TeamMemberCardProps = Omit<TeamPageProps, "employees" | "token"> & { employee: Employee };

function TeamMemberCard({ employee, rentals, creative, payroll, onSetup }: TeamMemberCardProps) {
  const roster = useTeamRoster();
  const account = payroll?.accounts?.find(item => item.employeeId === employee.id);
  const advance = payroll?.balances.find(item => item.employeeId === employee.id);
  const assigned = rentals.filter(rental => rental.assignedEmployeeIds.includes(employee.id));
  const creativePay = creativeEarnings(creative.filter(item => item.employeeId === employee.id)).metrics;
  const paid = creativePay.paid + assigned.reduce((sum, rental) => sum + paidEarnings(rental.employeePayouts[employee.id]), 0);
  const owed = creativePay.owed + assigned.reduce((sum, rental) => sum + (rentalState(rental, employee.id) === "earned" ? unpaidEarnings(rental.employeePayouts[employee.id]) : 0), 0);
  const next = assigned.find(rental => rentalState(rental, employee.id) === "upcoming");
  const active = roster?.isActive(employee.id) !== false;

  return <article className="panel employee-card">
    <div className="employee-card-head">
      <PersonAvatar personId={employee.id} name={employee.name} className="employee-avatar large" />
      <div><h2>{employee.name}</h2><p title={employee.email}>{employee.email ?? (employee.onboarding ? "Account setup needed" : "")}</p></div>
    </div>
    <div className="team-active-control">
      <span>{active ? "Active" : "Inactive"}</span>
      <Switch size="sm" aria-label={`${employee.name} active on team`} checked={active}
        disabled={!roster || roster.loading || roster.busy || Boolean(roster.error)}
        onCheckedChange={value => void roster?.setActive(employee.id, value)} />
    </div>
    <div className="employee-stats">
      <div><span>Earned</span><strong>{dollars(paid + owed)}</strong></div>
      <div><span>{advance?.remainingCents ? "Advance left" : "Still owed"}</span><strong>{dollars(advance?.remainingCents || account?.payableCents || (account ? 0 : owed), true)}</strong></div>
      <div><span>Appointments</span><strong>{assigned.length}</strong></div>
    </div>
    <div className="employee-next"><CalendarDays size={14} /><span>Next accepted</span><strong>{next ? formatDate(next.start, true) : "None scheduled"}</strong></div>
    <RentalDeductionStart employee={employee} />
    {employee.onboarding && !employee.accessReady && <Button className="team-setup-action" variant="outline" onClick={onSetup}>Set up private account</Button>}
  </article>;
}

export function TeamPage({ employees, rentals, creative, payroll, onSetup, token }: TeamPageProps) {
  const roster = useTeamRoster();
  const visibleEmployees = employees.filter(employee => roster?.visible(employee.id) !== false);

  return <>
    <div className="roster-heading"><p>Turn Active off to hide someone from the working team. History and balances stay saved.</p><IncludeInactive /></div>
    {roster?.error && <p role="alert" className="schedule-error">{roster.error} <button onClick={() => void roster.refresh()}>Reload team</button></p>}
    {token && <TeamNotifications token={token} employees={employees} />}
    <div className="team-page-grid">
      {visibleEmployees.map(employee => <TeamMemberCard key={employee.id} employee={employee} rentals={rentals} creative={creative} payroll={payroll} onSetup={onSetup} />)}
    </div>
  </>;
}
