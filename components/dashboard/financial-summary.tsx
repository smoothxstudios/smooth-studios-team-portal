"use client";

import { APPOINTMENT_CATEGORIES } from "@/lib/appointment-categories.mjs";
import { appointmentCategory,dollars,formatDate } from "@/lib/dashboard-presentation";
import type {
Rental
} from "@/lib/dashboard-types";
import { customerFullyPaid,ownerPeriodFinances,recognizedRevenue } from "@/lib/owner-finances.mjs";
import { useCreativeWork,type CreativeAssignment } from "@/lib/use-creative-work";
import {
CalendarDays,
ChevronRight,
Clock3,
WalletCards
} from "lucide-react";

export function OwnerFinancialSummary({ rentals, creative, upcomingCount, totalOwed, onSchedule, onPayouts }: {
  rentals: Rental[]; creative: ReturnType<typeof useCreativeWork>; upcomingCount: number; totalOwed: number;
  onSchedule: () => void; onPayouts: () => void;
}) {
  const now = Date.now();
  const periods = ownerPeriodFinances(rentals, creative.items, now);
  const ready = creative.loaded && !creative.error;
  return <section className="owner-finances" aria-label="Weekly and monthly revenue after team pay">
    <div className="owner-finance-grid">{periods.map(period => {
      const payReady = ready && !period.missingRates;
      return <article className="owner-finance-card" key={period.id}>
        <header><h2>{period.label}</h2><span>{formatDate(period.start)}–{formatDate(new Date(now).toISOString())}</span></header>
        <div className="owner-finance-revenue"><span>Revenue</span><strong>{dollars(period.revenue, true)}</strong></div>
        <div className="owner-finance-deduction"><div><span>Team pay</span>{payReady && <small>{dollars(period.stillOwed, true)} still owed</small>}</div><strong>{payReady ? `−${dollars(period.teamPay, true)}` : "—"}</strong></div>
        <div className={`owner-finance-net${payReady && period.afterTeamPay < 0 ? " is-negative" : ""}`}><span>After team pay</span><strong>{payReady ? dollars(period.afterTeamPay, true) : "—"}</strong></div>
        {!payReady && <p className="owner-finance-status" role="status">{period.missingRates ? "Set missing employee pay rates to finish this total." : creative.error ? "Team pay is unavailable. Refresh to finish this total." : "Loading team pay…"}</p>}
      </article>;
    })}</div>
    <p className="owner-finance-basis">Completed, fully paid appointments, including tips. Team pay includes approved creative work, onboarding, training, and other recorded pay. Before fees and other expenses.</p>
    <div className="owner-finance-shortcuts"><button onClick={onSchedule}><CalendarDays size={16} />{upcomingCount} upcoming appointments<ChevronRight size={15} /></button><button onClick={onPayouts}><WalletCards size={16} />Total still owed: {ready ? dollars(totalOwed, true) : "—"}<ChevronRight size={15} /></button></div>
  </section>;
}

export function PeriodTotals({ rentals, employeeId, creative = [] }: { rentals: Rental[]; employeeId?: string; creative?: CreativeAssignment[] }) {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const periods = [
    { label: "This week", start: weekStart, previous: new Date(weekStart.getTime() - 7 * 86400000) },
    { label: "This month", start: monthStart, previous: new Date(now.getFullYear(), now.getMonth() - 1, 1) },
    { label: "This year", start: yearStart, previous: new Date(now.getFullYear() - 1, 0, 1) },
  ];
  const amountFor = (rental: Rental) => {
    if (employeeId) {
      if (!customerFullyPaid(rental) || new Date(rental.end) > now) return 0;
      return rental.employeePayouts[employeeId]?.amountCents ?? 0;
    }
    return recognizedRevenue(rental);
  };
  const secondaryFor = (rental: Rental) => {
    if (!customerFullyPaid(rental) || new Date(rental.end) > now) return 0;
    if (employeeId) return 1;
    return Object.values(rental.employeePayouts).reduce((sum, payout) => sum + payout.amountCents, 0);
  };

  return (
    <section className="period-strip">
      <div className="period-strip-title"><Clock3 size={17} /><div><strong>Period totals</strong><span>Week · month · year</span></div></div>
      {periods.map((period, index) => {
        const end = index === 0 ? new Date(weekStart.getTime() + 7 * 86400000) : index === 1 ? new Date(now.getFullYear(), now.getMonth() + 1, 1) : new Date(now.getFullYear() + 1, 0, 1);
        const previousEnd = period.start;
        const currentItems = rentals.filter((rental) => new Date(rental.start) >= period.start && new Date(rental.start) < end);
        const previousItems = rentals.filter((rental) => new Date(rental.start) >= period.previous && new Date(rental.start) < previousEnd);
        const earnedWork = creative.filter(item => item.status === "approved" && (!employeeId || item.employeeId === employeeId));
        const workTotal = (start: Date, end: Date) => earnedWork.filter(item => new Date(item.approvedAt!) >= start && new Date(item.approvedAt!) < end).reduce((sum, item) => sum + item.amountCents, 0);
        const total = currentItems.reduce((sum, rental) => sum + amountFor(rental), 0) + (employeeId ? workTotal(period.start, end) : 0);
        const previousTotal = previousItems.reduce((sum, rental) => sum + amountFor(rental), 0) + (employeeId ? workTotal(period.previous, previousEnd) : 0);
        const secondary = currentItems.reduce((sum, rental) => sum + secondaryFor(rental), 0) + (employeeId ? 0 : workTotal(period.start, end));
        const change = previousTotal ? Math.round(((total - previousTotal) / previousTotal) * 100) : null;
        return (
          <div className="period-total" key={period.label}>
            <span>{period.label}</span>
            <strong>{dollars(total)}</strong>
            <small>{employeeId ? `${secondary} completed appointment${secondary === 1 ? "" : "s"}${workTotal(period.start, end) ? " + approved creative work" : ""}` : `${dollars(secondary)} earned payroll`}</small>
            {(change !== null || !employeeId) && <em className={change !== null && change < 0 ? "down" : ""}>{change === null ? "No prior comparison" : `${change >= 0 ? "+" : ""}${change}% vs prior`}</em>}
          </div>
        );
      })}
    </section>
  );
}

export function CategoryRevenue({ rentals }: { rentals: Rental[] }) {
  const rows = APPOINTMENT_CATEGORIES.map((category) => {
    const appointments = rentals.filter((rental) => appointmentCategory(rental).id === category.id);
    const fullyPaid = appointments.filter(customerFullyPaid);
    return {
      id: category.id,
      label: category.label,
      appointmentCount: appointments.length,
      paidCount: fullyPaid.length,
      revenue: fullyPaid.reduce((sum, rental) => sum + recognizedRevenue(rental), 0),
    };
  }).filter((category) => category.appointmentCount > 0);

  if (!rows.length) return null;
  return (
    <section className="panel category-revenue-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">Business mix</p><h2>Revenue by category</h2></div>
        <span className="category-revenue-note">Fully paid appointments</span>
      </div>
      <div className="category-revenue-grid">
        {rows.map((category) => (
          <article className="category-revenue-card" key={category.id}>
            <span className={`category-marker category-${category.id}`} />
            <div><strong>{category.label}</strong><small>{category.paidCount} of {category.appointmentCount} paid</small></div>
            <b>{dollars(category.revenue)}</b>
          </article>
        ))}
      </div>
    </section>
  );
}
