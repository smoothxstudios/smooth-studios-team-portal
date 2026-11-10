"use client";
import { RentalDeductions } from "@/components/dashboard/rental-deductions";
import { PersonAvatar } from "@/components/team-profile";
import { teamEarnings } from "@/lib/team-summary.mjs";
import type { CreativeAssignment } from "@/lib/use-creative-work";
import type { ReactNode } from "react";

import { ChartTooltip } from "@/components/dashboard/shared";
import { Button } from "@/components/ui/button";
import { dollars,formatDate } from "@/lib/dashboard-presentation";
import type { Employee,PayrollState,Rental } from "@/lib/dashboard-types";
import { ChevronDown } from "lucide-react";
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
  rentals,
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
  const advance = payroll?.balances.find(item => item.employeeId === employeeId);
  const hasChartData = monthly.some(month => month.paid > 0 || month.owed > 0);
  return (
    <section className={`payout-layout${isOwner ? "" : " employee-payout-layout"}`}>
      {isOwner && <article className="panel team-payout-breakdown"><div className="team-payout-heading"><div><h2>Pay by team member</h2><p>Earned pay and payments</p></div>{addPay}</div>
        <div className="team-payout-people">{teamEarnings(employees, rentals, creative).map(person => {
          const account = payroll?.accounts?.find(item => item.employeeId === person.id);
          const rentalDeduction = account ? Math.min(account.grossOwedCents, account.rentalBalanceCents) : 0;
          return <section className="team-payout-person" key={person.id}>
            <div className="person-section-heading"><PersonAvatar personId={person.id} name={person.name} className="employee-avatar" /><h3>{person.name}</h3></div>
            <div className="team-payout-details">
              <dl className="team-payout-metrics">
                <div className={(account?.payableCents ?? person.owed) > 0 ? "has-balance" : undefined}><dt>Amount owed</dt><dd>{dollars(account?.payableCents ?? person.owed, true)}</dd></div>
                <div><dt>Total earned</dt><dd>{dollars(person.earned, true)}</dd></div>
                <div><dt>Paid</dt><dd>{dollars(person.cashPaid, true)}</dd></div>
              </dl>
              {(person.advanceApplied > 0 || (account?.rentalBalanceCents ?? 0) > 0) && <div className="team-payout-adjustments">
                {person.advanceApplied > 0 && <p className="team-payout-advance"><span>Advance applied</span><strong>{dollars(person.advanceApplied, true)}</strong></p>}
                {account && account.rentalBalanceCents > 0 && <details className="team-payout-adjustment">
                  <summary aria-label={`View rental breakdown for ${person.name}`}><span>{rentalDeduction > 0 ? "Rental deduction" : "Rental balance"}</span><strong>{rentalDeduction > 0 ? `−${dollars(rentalDeduction, true)}` : dollars(account.carryForwardCents, true)}</strong><ChevronDown size={15} aria-hidden="true" /></summary>
                  <div className="team-payout-rental-balance">
                    {rentalDeduction > 0 && <>
                      <p><span>Unpaid earnings</span><strong>{dollars(account.grossOwedCents, true)}</strong></p>
                      <p><span>Studio rental deduction</span><strong>−{dollars(rentalDeduction, true)}</strong></p>
                      <small>Already included in Amount owed.</small>
                    </>}
                    {account.carryForwardCents > 0 && <p><span>Rental balance carried forward</span><strong>{dollars(account.carryForwardCents, true)}</strong></p>}
                  </div>
                </details>}
              </div>}
              {person.missingRates > 0 && <p className="schedule-warning">Pay rate needed for {person.missingRates} appointment{person.missingRates === 1 ? "" : "s"}.</p>}
            </div>
            <Button className="team-payout-record" variant="outline" aria-label={`Record payment for ${person.name}`} onClick={() => { setPayoutEmployee(person.id); onContinue(); }}>Record payment</Button>
          </section>;
        })}</div>
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
      <RentalDeductions charges={payroll?.rentalCharges ?? []} employees={employees} rentals={rentals} isOwner={isOwner} />
    </section>
  );
}
