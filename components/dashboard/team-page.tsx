"use client";

import { Button } from "@/components/ui/button";
import { creativeEarnings } from "@/lib/creative-work.mjs";
import { dollars,formatDate,paidEarnings,rentalState,teamAccent,unpaidEarnings } from "@/lib/dashboard-presentation";
import type {
DashboardPayload,
Employee,PayrollState,Rental
} from "@/lib/dashboard-types";
import { type CreativeAssignment } from "@/lib/use-creative-work";
import {
CalendarDays
} from "lucide-react";
import { useState } from "react";

export function TeamPage({ employees, rentals, creative, payroll, teamAccess, onSetup }: { employees: Employee[]; rentals: Rental[]; creative: CreativeAssignment[]; payroll?: PayrollState; teamAccess?: DashboardPayload["teamAccess"]; onSetup: () => void }) {
  const [copied, setCopied] = useState("");
  return (
    <div className="team-page-grid">
      {employees.map((employee) => {
        const advance = payroll?.balances.find(item => item.employeeId === employee.id);
        const assigned = rentals.filter((rental) => rental.assignedEmployeeIds.includes(employee.id));
        const creativePay = creativeEarnings(creative.filter(item => item.employeeId === employee.id)).metrics;
        const paid = creativePay.paid + assigned.reduce((sum, rental) => sum + paidEarnings(rental.employeePayouts[employee.id]), 0);
        const owed = creativePay.owed + assigned.reduce((sum, rental) => sum + (rentalState(rental, employee.id) === "earned" ? unpaidEarnings(rental.employeePayouts[employee.id]) : 0), 0);
        const next = assigned.find((rental) => rentalState(rental, employee.id) === "upcoming");
        return (
          <article className="panel employee-card" key={employee.id}>
            <div className="employee-card-head"><span className="employee-avatar large" style={{ background: teamAccent(employee.id, employee.accent) }}>{employee.name.slice(0, 1)}</span><div><h2>{employee.name}</h2><p title={employee.email}>{employee.email ?? (employee.onboarding ? "Account setup needed" : "")}</p></div></div>
            <div className="employee-stats"><div><span>Earned</span><strong>{dollars(paid + owed)}</strong></div><div><span>{advance?.remainingCents ? "Advance left" : "Still owed"}</span><strong>{dollars(advance?.remainingCents || owed, true)}</strong></div><div><span>Appointments</span><strong>{assigned.length}</strong></div></div>
            <div className="employee-next"><CalendarDays size={14} /><span>Next accepted</span><strong>{next ? formatDate(next.start, true) : "None scheduled"}</strong></div>
            {employee.onboarding && !employee.accessReady && <Button className="team-setup-action" variant="outline" onClick={onSetup}>Set up private account</Button>}
            {teamAccess?.[employee.id] && <Button className="team-setup-action" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(teamAccess[employee.id].password); setCopied(employee.id); } catch { setCopied(`unavailable:${employee.id}`); } }}>{copied === employee.id ? "Password copied" : "Copy sign-in password"}</Button>}
            {copied === `unavailable:${employee.id}` && teamAccess?.[employee.id] && <p className="team-account-password">{teamAccess[employee.id].password}</p>}
          </article>
        );
      })}
    </div>
  );
}
