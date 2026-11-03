"use client";
import { studioLocal } from "@/lib/team-schedule.mjs";
import { teamEarnings } from "@/lib/team-summary.mjs";
import { teamAccent } from "@/lib/dashboard-presentation";
import type { CreativeAssignment } from "@/lib/use-creative-work";
import type { ReactNode } from "react";

import { ChartTooltip } from "@/components/dashboard/shared";
import { Button } from "@/components/ui/button";
import {
Select,
SelectContent,
SelectItem,
SelectTrigger,
SelectValue,
} from "@/components/ui/select";
import { dollars,eligibleForPayout,formatDate } from "@/lib/dashboard-presentation";
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
  creative = [],
  addPay,
}: {
  addPay?: ReactNode;
  creative?: CreativeAssignment[];
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
      {isOwner && <article className="panel team-payout-breakdown"><div className="panel-heading"><div><h2>Pay by team member</h2><p>Appointments, training, onboarding, and other earned pay</p></div>{addPay}</div>
        <div className="team-payout-people">{teamEarnings(employees, rentals, creative).map(person => { const account=payroll?.accounts?.find(item=>item.employeeId===person.id); return <section className="team-payout-person" key={person.id}>
          <div className="person-section-heading"><span className="employee-avatar" style={{ background: teamAccent(person.id, person.accent) }}>{person.name.slice(0, 1)}</span><h3>{person.name}</h3></div>
          <dl><div><dt>Amount owed</dt><dd>{dollars(account?.payableCents ?? person.owed, true)}</dd></div><div><dt>Total earned</dt><dd>{dollars(person.earned, true)}</dd></div><div><dt>Paid</dt><dd>{dollars(person.cashPaid, true)}</dd></div>{person.advanceApplied > 0 && <div className="team-payout-advance"><dt>Advance applied</dt><dd>{dollars(person.advanceApplied, true)}</dd></div>}</dl>
          {person.missingRates > 0 && <p className="schedule-warning">Pay rate needed for {person.missingRates} appointment{person.missingRates === 1 ? "" : "s"}.</p>}
        {account && account.rentalBalanceCents>0 && <p>Studio rental balance: {dollars(account.rentalBalanceCents,true)}{account.carryForwardCents>0?` · ${dollars(account.carryForwardCents,true)} carries forward`:""}</p>}
          <Button variant="outline" onClick={()=>{setPayoutEmployee(person.id);onContinue();}}>Record payment</Button>
        </section>;})}</div>
      </article>}
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
      <article className="panel payment-account-history"><div className="panel-heading"><h2>Payment history</h2></div>
        {payroll?.paymentReceipts?.length ? payroll.paymentReceipts.map(receipt=><details className="payment-line-items" key={receipt.id}><summary>{isOwner?`${employees.find(p=>p.id===receipt.employeeId)?.name??receipt.employeeId} · `:""}{dollars(receipt.cashCents,true)} · {formatDate(receipt.recordedAt)}</summary><p>Work through {receipt.through} · {receipt.method||"Method not specified"}</p><p>{dollars(receipt.grossCents,true)} earnings settled · {dollars(receipt.deductionCents,true)} rental deductions</p>{receipt.note&&<p>{receipt.note}</p>}<small>Receipt {receipt.id.slice(0,8)}</small></details>) : <p>Payments recorded here will appear with a receipt and the work dates covered. Earlier payments remain included in the totals.</p>}
      </article>
      {(payroll?.rentalCharges?.length??0)>0 && <article className="panel payment-account-history"><div className="panel-heading"><h2>Team studio rentals</h2></div><p>The unpaid booking price reduces the account balance. Amounts already paid online are excluded.</p>{payroll!.rentalCharges!.map(charge=><div className="payment-charge" key={`${charge.employeeId}:${charge.rentalId}`}><strong>{isOwner?`${employees.find(p=>p.id===charge.employeeId)?.name??charge.employeeId} · `:""}{charge.title}</strong><span>{formatDate(charge.earnedAt)} · {dollars(charge.priceCents,true)} booking · {dollars(charge.paidOnlineCents,true)} already paid</span><span>{dollars(charge.appliedCents,true)} deducted · {dollars(charge.outstandingCents,true)} remaining</span>{charge.needsReview&&<p role="alert" className="schedule-warning">This rental changed after a deduction. Review the saved payment before recording more.</p>}</div>)}</article>}
    </section>
  );
}
