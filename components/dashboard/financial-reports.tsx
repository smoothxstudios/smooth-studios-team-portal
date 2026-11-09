"use client";
import { CategoryRevenue,PeriodTotals } from "@/components/dashboard/financial-summary";
import { ChartTooltip } from "@/components/dashboard/shared";
import { StripeMoneyFlow } from "@/components/dashboard/stripe-money-flow";
import type { DashboardPayload,Rental } from "@/lib/dashboard-types";
import type { CreativeAssignment } from "@/lib/use-creative-work";
import {
Area,
AreaChart,
CartesianGrid,
ResponsiveContainer,
Tooltip,
XAxis,
YAxis
} from "recharts";
export default function FinancialReports({rentals,creative,monthly,summary,payments,onMatch}:{rentals:Rental[];creative:CreativeAssignment[];monthly:{month:string;revenue:number;payroll:number}[];summary:DashboardPayload["stripeSummary"];payments:NonNullable<DashboardPayload["unmatchedStripePayments"]>;onMatch:(id?:string)=>void}) {
 return (<div className="owner-reports-content">
                  <PeriodTotals creative={creative} rentals={rentals} />
                  <article className="panel trend-panel">
                    <div className="panel-heading"><h2>Revenue &amp; payroll</h2><div className="chart-legend"><span className="legend-red" />Revenue<span className="legend-dark" />Payroll</div></div>
                    <div className="chart-wrap"><ResponsiveContainer height="100%" width="100%"><AreaChart data={monthly} margin={{ left: -18, right: 6, top: 12, bottom: 0 }}><defs><linearGradient id="redFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#e10000" stopOpacity={0.24} /><stop offset="100%" stopColor="#e10000" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 6" vertical={false} /><XAxis axisLine={false} dataKey="month" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickLine={false} /><YAxis axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(value) => `$${value / 100}`} tickLine={false} /><Tooltip content={<ChartTooltip />} /><Area dataKey="payroll" fill="transparent" name="Payroll" stroke="var(--muted-foreground)" strokeDasharray="5 5" strokeWidth={2} type="monotone" /><Area dataKey="revenue" fill="url(#redFill)" name="Revenue" stroke="#e10000" strokeWidth={3} type="monotone" /></AreaChart></ResponsiveContainer></div>
                  </article>
                  <StripeMoneyFlow onMatch={onMatch} summary={summary} unmatchedPayments={payments} />
                  <CategoryRevenue rentals={rentals} />
                </div>);
}
