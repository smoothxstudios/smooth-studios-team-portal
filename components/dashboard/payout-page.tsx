"use client";

import { ChartTooltip } from "@/components/dashboard/shared";
import { Button } from "@/components/ui/button";
import {
Select,
SelectContent,
SelectItem,
SelectTrigger,
SelectValue,
} from "@/components/ui/select";
import { dollars,eligibleForPayout } from "@/lib/dashboard-presentation";
import type { Employee,PayrollState,Rental } from "@/lib/dashboard-types";
import {
ArrowRight,
ReceiptText
} from "lucide-react";
import {
Bar,
BarChart,
CartesianGrid,
ResponsiveContainer,
Tooltip,
XAxis,
YAxis
} from "recharts";

export function PayoutPage({
  employeeId,
  employees,
  metrics,
  monthly,
  onContinue,
  paidThrough,
  payoutEmployee,
  rentals,
  setPaidThrough,
  setPayoutEmployee,
  payroll,
}: {
  employeeId?: string;
  payroll?: PayrollState;
  employees: Employee[];
  metrics: { revenue: number; owed: number; paid: number; projected: number };
  monthly: Array<{ month: string; paid: number; owed: number }>;
  onContinue: () => void;
  paidThrough: string;
  payoutEmployee: string;
  rentals: Rental[];
  setPaidThrough: (value: string) => void;
  setPayoutEmployee: (value: string) => void;
}) {
  const isOwner = !employeeId;
  const selectedEmployee = employees.find((employee) => employee.id === payoutEmployee);
  const advance = payroll?.balances.find(item => item.employeeId === employeeId);
  const payoutScopeLabel = selectedEmployee?.name ?? "All employees";
  const eligibleAppointments = rentals.filter((rental) => eligibleForPayout(rental, paidThrough, payoutEmployee)).length;
  const hasChartData = monthly.some(month => month.paid > 0 || month.owed > 0);
  return (
    <section className={`payout-layout${isOwner ? "" : " employee-payout-layout"}`}>
      <article className="panel payout-chart-panel">
        <div className="panel-heading"><div>{isOwner && <p className="eyebrow">Weekly · monthly · yearly</p>}<h2>{isOwner ? "Team payouts" : "Earnings summary"}</h2></div></div>
        <div className="payout-summary"><div><span>{isOwner ? "Paid to team" : "Paid"}</span><strong>{dollars(metrics.paid)}</strong></div><div><span>{isOwner ? "Earned, unpaid" : advance?.remainingCents ? "Advance remaining" : "Pay owed"}</span><strong>{dollars(!isOwner && advance?.remainingCents ? advance.remainingCents : metrics.owed, true)}</strong></div><div><span>{isOwner ? "Projected" : "Upcoming estimate"}</span><strong>{dollars(metrics.projected)}</strong></div></div>
        {payroll?.balances.length ? <div className="payroll-advances">{payroll.balances.filter(item => isOwner || item.employeeId === employeeId).map(item => <div key={item.employeeId} className="payroll-advance"><div><strong>{isOwner ? `${employees.find(person => person.id === item.employeeId)?.name ?? item.employeeId} · ` : ""}{item.remainingCents > 0 ? "Advance balance" : "Advance cleared"}</strong><span>{dollars(item.appliedCents, true)} applied · {dollars(item.remainingCents, true)} remaining</span></div><progress max={item.totalCents} value={item.appliedCents} aria-label="Advance cleared" /></div>)}</div> : null}
        {(isOwner || hasChartData) ? <div className="bar-chart-wrap">
          <ResponsiveContainer height="100%" width="100%">
            <BarChart data={monthly} margin={{ left: -20, right: 0 }}>
              <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 6" vertical={false} />
              <XAxis axisLine={false} dataKey="month" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickLine={false} />
              <YAxis axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(value) => `$${value / 100}`} tickLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="paid" fill="#1f9d63" name="Paid" radius={[5, 5, 0, 0]} />
              <Bar dataKey="owed" fill="#e10000" name="Owed" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div> : <p className="employee-chart-empty">Your earnings chart will appear after an appointment is earned or creative work is approved.</p>}
      </article>
      {isOwner && (
        <article className="panel mark-paid-card">
          <h2>Record appointment pay</h2>
          <p>Choose who you paid and the last appointment date covered. Record creative work payouts in the section below.</p>
          <div className="payout-control">
            <label id="payout-employee-label">Employee selection</label>
            <Select onValueChange={setPayoutEmployee} value={payoutEmployee}>
              <SelectTrigger aria-labelledby="payout-employee-label" className="payout-employee-select"><SelectValue /></SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="all">All employees</SelectItem>
                {employees.map((employee) => <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="payout-control">
            <label htmlFor="paid-through">Mark paid through</label>
            <input id="paid-through" max={new Date().toISOString().slice(0, 10)} onChange={(event) => setPaidThrough(event.target.value)} type="date" value={paidThrough} />
          </div>
          <div className="workflow-scope"><ReceiptText size={16} /><span>{payoutScopeLabel} · {eligibleAppointments} eligible appointment{eligibleAppointments === 1 ? "" : "s"}</span></div>
          <Button className="github-button" onClick={onContinue}>Review and mark paid <ArrowRight size={16} /></Button>
        </article>
      )}
    </section>
  );
}
