"use client";
import { PersonAvatar } from "@/components/team-profile";

import { Button } from "@/components/ui/button";
import { TeamNotifications } from "@/components/team-notifications";
import { creativeEarnings } from "@/lib/creative-work.mjs";
import { dollars,formatDate,paidEarnings,rentalState,unpaidEarnings } from "@/lib/dashboard-presentation";
import type {
Employee,PayrollState,Rental
} from "@/lib/dashboard-types";
import { type CreativeAssignment } from "@/lib/use-creative-work";
import {
CalendarDays
} from "lucide-react";

export function TeamPage({ employees, rentals, creative, payroll, onSetup, token }: { employees: Employee[]; rentals: Rental[]; creative: CreativeAssignment[]; payroll?: PayrollState; onSetup: () => void; token?: string }) {
  return (
    <>
    {token && <TeamNotifications token={token} employees={employees} />}
    <div className="team-page-grid">
      {employees.map((employee) => {
        const account=payroll?.accounts?.find(item=>item.employeeId===employee.id);
        const advance = payroll?.balances.find(item => item.employeeId === employee.id);
        const assigned = rentals.filter((rental) => rental.assignedEmployeeIds.includes(employee.id));
        const creativePay = creativeEarnings(creative.filter(item => item.employeeId === employee.id)).metrics;
        const paid = creativePay.paid + assigned.reduce((sum, rental) => sum + paidEarnings(rental.employeePayouts[employee.id]), 0);
        const owed = creativePay.owed + assigned.reduce((sum, rental) => sum + (rentalState(rental, employee.id) === "earned" ? unpaidEarnings(rental.employeePayouts[employee.id]) : 0), 0);
        const next = assigned.find((rental) => rentalState(rental, employee.id) === "upcoming");
        return (
          <article className="panel employee-card" key={employee.id}>
            <div className="employee-card-head"><PersonAvatar personId={employee.id} name={employee.name} className="employee-avatar large" /><div><h2>{employee.name}</h2><p title={employee.email}>{employee.email ?? (employee.onboarding ? "Account setup needed" : "")}</p></div></div>
            <div className="employee-stats"><div><span>Earned</span><strong>{dollars(paid + owed)}</strong></div><div><span>{advance?.remainingCents ? "Advance left" : "Still owed"}</span><strong>{dollars(advance?.remainingCents || account?.payableCents || (account ? 0 : owed), true)}</strong></div><div><span>Appointments</span><strong>{assigned.length}</strong></div></div>
            <div className="employee-next"><CalendarDays size={14} /><span>Next accepted</span><strong>{next ? formatDate(next.start, true) : "None scheduled"}</strong></div>
            {employee.onboarding && !employee.accessReady && <Button className="team-setup-action" variant="outline" onClick={onSetup}>Set up private account</Button>}
          </article>
        );
      })}
    </div>
    </>
  );
}
