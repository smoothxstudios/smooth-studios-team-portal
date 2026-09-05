"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowRight,
  Banknote,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Eye,
  EyeOff,
  GitBranch,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  Moon,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Sun,
  Users,
  WalletCards,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { decryptDashboard } from "@/lib/dashboard-crypto";
import { APPOINTMENT_CATEGORIES, categorizeAppointment } from "@/lib/appointment-categories.mjs";
import { GithubWorkflowDialog, type OwnerWorkflowRequest } from "@/components/github-workflow-dialog";
import type {
  AccessProfile,
  DashboardPayload,
  Employee,
  EncryptedEnvelope,
  Rental,
} from "@/lib/dashboard-types";

const FALLBACK_PROFILES: AccessProfile[] = [
  { id: "owner", label: "Smooth", role: "owner" },
  { id: "akiva", label: "Akiva", role: "employee" },
  { id: "jordyn", label: "Jordyn", role: "employee" },
  { id: "rayne", label: "Rayne", role: "employee" },
];
const TEAM_ACCENTS: Record<string, string> = {
  akiva: "rgb(225, 0, 0)",
  jordyn: "rgb(0, 126, 87)",
  rayne: "rgb(37, 99, 235)",
};
const STUDIO_TIME_ZONE = "America/New_York";
const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const MONEY_EXACT = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

type ViewKey = "overview" | "rentals" | "team" | "payouts";
type RentalState = "upcoming" | "earned" | "paid" | "awaiting";
type CustomerPaymentState = "paid" | "deposit" | "review" | "pending";
type AppointmentStatus = RentalState | "customer-paid" | "upcoming-paid" | "deposit" | "review";
type PaymentFilter = "all" | CustomerPaymentState;

const NAV_ITEMS: { key: ViewKey; label: string; icon: typeof LayoutDashboard; ownerOnly?: boolean }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "rentals", label: "Appointments", icon: CalendarDays },
  { key: "team", label: "Team", icon: Users, ownerOnly: true },
  { key: "payouts", label: "Payouts", icon: WalletCards },
];

function dollars(cents: number, exact = false) {
  return (exact ? MONEY_EXACT : MONEY).format(cents / 100);
}

function teamAccent(id: string, fallback = "#242428") {
  return TEAM_ACCENTS[id.toLowerCase()] ?? fallback;
}

function formatDate(value: string, compact = false) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: STUDIO_TIME_ZONE,
    month: compact ? "short" : "long",
    day: "numeric",
    year: compact ? undefined : "numeric",
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: STUDIO_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function durationLabel(rental: Rental) {
  const minutes = Math.round((new Date(rental.end).getTime() - new Date(rental.start).getTime()) / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} hr` : `${hours.toFixed(1)} hrs`;
}

function customerFullyPaid(rental: Rental) {
  if (rental.paymentOverride !== undefined) return rental.fullyPaid;
  return rental.fullyPaid || (rental.paidOnlineCents !== null && rental.paidOnlineCents >= rental.priceCents);
}

function tipAmount(rental: Rental) {
  return rental.tipCents ?? Math.max((rental.paidOnlineCents ?? 0) - rental.priceCents, 0);
}

function recognizedRevenue(rental: Rental) {
  return customerFullyPaid(rental) ? rental.priceCents + tipAmount(rental) : 0;
}

function customerPaymentState(rental: Rental): CustomerPaymentState {
  if (customerFullyPaid(rental)) return "paid";
  if (new Date(rental.end).getTime() <= Date.now()) return "review";
  if ((rental.paidOnlineCents ?? 0) > 0) return "deposit";
  return "pending";
}

function rentalState(rental: Rental, employeeId?: string): RentalState {
  const ended = new Date(rental.end).getTime() <= Date.now();
  if (!ended) return "upcoming";
  if (!customerFullyPaid(rental)) return "awaiting";
  if (employeeId && rental.employeePayouts[employeeId]?.paid) return "paid";
  return "earned";
}

function eligibleForPayout(rental: Rental, paidThrough: string, employeeScope: string) {
  if (new Date(rental.end) > new Date(`${paidThrough}T23:59:59`) || !customerFullyPaid(rental)) return false;
  if (employeeScope === "all") return Object.values(rental.employeePayouts).some((payout) => !payout.paid);
  const payout = rental.employeePayouts[employeeScope];
  return Boolean(payout && !payout.paid);
}

function appointmentStatus(rental: Rental, employeeId?: string): AppointmentStatus {
  const paymentState = customerPaymentState(rental);
  if (paymentState === "deposit") return "deposit";
  if (paymentState === "pending") return "awaiting";
  if (paymentState === "review") return "review";
  if (new Date(rental.end).getTime() > Date.now()) return "upcoming-paid";
  if (!employeeId) return "customer-paid";
  return rentalState(rental, employeeId);
}

function appointmentCategory(rental: Rental) {
  if (rental.categoryId && rental.category) return { id: rental.categoryId, label: rental.category };
  const category = categorizeAppointment(rental.title);
  return { id: category.id, label: category.label };
}

function CategoryBadge({ rental }: { rental: Rental }) {
  const category = appointmentCategory(rental);
  return <span className={`category-badge category-${category.id}`}>{category.label}</span>;
}

function StatusBadge({ state }: { state: AppointmentStatus }) {
  const labels: Record<AppointmentStatus, string> = {
    upcoming: "Upcoming",
    "upcoming-paid": "Upcoming · paid",
    earned: "Earned",
    paid: "Paid out",
    awaiting: "Payment pending",
    deposit: "Deposit paid",
    review: "Review balance",
    "customer-paid": "Customer paid",
  };
  return <span className={`status status-${state}`}><span />{labels[state]}</span>;
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`studio-logo ${compact ? "studio-logo-compact" : ""}`}>
      {/* The relative URL keeps the brand asset compatible with a GitHub Pages base path. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="./smooth-studios-logo.png" alt="Smooth Studios" />
    </div>
  );
}

function LoginScreen({ profiles, onUnlock }: { profiles: AccessProfile[]; onUnlock: (profile: AccessProfile, password: string) => Promise<void> }) {
  const [selectedId, setSelectedId] = useState(profiles[0]?.id ?? "owner");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const profile = profiles.find((item) => item.id === selectedId);
    if (!profile || !password) return;
    setLoading(true);
    setError("");
    try {
      await onUnlock(profile, password);
    } catch {
      setError("That password did not unlock this dashboard. Please try again.");
      setPassword("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-shell">
      <div className="login-card">
        <Logo />
        <div className="login-heading">
          <p className="eyebrow">Team portal</p>
          <h1>Sign in</h1>
        </div>
        <form onSubmit={submit}>
          <label className="select-label" htmlFor="dashboard-profile">Dashboard</label>
          <div className="select-field">
            <Users aria-hidden="true" size={17} />
            <select
              id="dashboard-profile"
              onChange={(event) => { setSelectedId(event.target.value); setError(""); }}
              value={selectedId}
            >
              {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
            </select>
            <ChevronDown aria-hidden="true" size={17} />
          </div>
            <label className="password-label" htmlFor="dashboard-password">Password</label>
            <div className="password-field">
              <LockKeyhole size={17} />
              <input
                autoComplete="current-password"
                id="dashboard-password"
                onChange={(event) => { setPassword(event.target.value); setError(""); }}
                placeholder="Enter your private password"
                type={showPassword ? "text" : "password"}
                value={password}
              />
              <button aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)} type="button">
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            {error && <p className="login-error" role="alert">{error}</p>}
            <Button className="unlock-button" disabled={!password || loading} size="lg" type="submit">
              {loading ? "Signing in…" : "Sign in"}<ArrowRight size={17} />
            </Button>
        </form>
      </div>
    </main>
  );
}

function ThemeControl({ dark, onChange }: { dark: boolean; onChange: (dark: boolean) => void }) {
  return <div className="theme-control"><Sun size={15} /><Switch aria-label="Use dark theme" checked={dark} onCheckedChange={onChange} /><Moon size={15} /></div>;
}

function KpiCard({ label, value, note, icon: Icon, tone }: { label: string; value: string; note: string; icon: typeof Banknote; tone: "red" | "green" | "blue" | "amber" }) {
  return <article className={`kpi-card tone-${tone}`}><div className="kpi-heading"><span>{label}</span><div className="kpi-icon"><Icon size={19} /></div></div><strong>{value}</strong><p>{note}</p></article>;
}

function PeriodTotals({ rentals, employeeId }: { rentals: Rental[]; employeeId?: string }) {
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
        const total = currentItems.reduce((sum, rental) => sum + amountFor(rental), 0);
        const previousTotal = previousItems.reduce((sum, rental) => sum + amountFor(rental), 0);
        const secondary = currentItems.reduce((sum, rental) => sum + secondaryFor(rental), 0);
        const change = previousTotal ? Math.round(((total - previousTotal) / previousTotal) * 100) : null;
        return (
          <div className="period-total" key={period.label}>
            <span>{period.label}</span>
            <strong>{dollars(total)}</strong>
            <small>{employeeId ? `${secondary} completed appointment${secondary === 1 ? "" : "s"}` : `${dollars(secondary)} earned payroll`}</small>
            <em className={change !== null && change < 0 ? "down" : ""}>{change === null ? "No prior comparison" : `${change >= 0 ? "+" : ""}${change}% vs prior`}</em>
          </div>
        );
      })}
    </section>
  );
}

function CategoryRevenue({ rentals }: { rentals: Rental[] }) {
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

function PaymentReview({ rentals, onOpen, onOverride }: { rentals: Rental[]; onOpen: () => void; onOverride: () => void }) {
  const appointments = rentals.filter((rental) => customerPaymentState(rental) === "review");
  if (!appointments.length) return null;
  const unrecorded = appointments.reduce((sum, rental) => sum + Math.max(rental.priceCents - (rental.paidOnlineCents ?? 0), 0), 0);

  return (
    <section className="panel payment-review-panel">
      <div className="payment-review-copy">
        <span className="payment-review-icon"><ReceiptText size={21} /></span>
        <div>
          <p className="eyebrow">Payment check</p>
          <h2>{appointments.length} completed appointment{appointments.length === 1 ? "" : "s"} need review</h2>
          <p>The Calendar event shows a deposit or no checkout payment. Confirm whether the balance is still unpaid or was received by invoice, cash, Apple Pay, or another method.</p>
        </div>
      </div>
      <div className="payment-review-total"><span>Not recorded on event</span><strong>{dollars(unrecorded)}</strong><small>This may include invoice or other payments.</small></div>
      <div className="payment-review-actions"><Button onClick={onOpen} size="sm" variant="outline">Review appointments</Button><Button onClick={onOverride} size="sm">Record payment received</Button></div>
    </section>
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><p>{label}</p>{payload.map((item) => <div key={item.name}><span style={{ background: item.color }} />{item.name}<strong>{dollars(item.value)}</strong></div>)}</div>;
}

function PaymentAmount({ rental, showDetails }: { rental: Rental; showDetails: boolean }) {
  const paidOnline = rental.paidOnlineCents ?? 0;
  const tip = tipAmount(rental);
  const remaining = Math.max(rental.priceCents - paidOnline, 0);
  let detail = "No online payment recorded";
  let tone = "pending";

  if (rental.paymentOverride === true && remaining > 0) {
    detail = paidOnline > 0 ? `${dollars(paidOnline, true)} online · payment confirmed` : "Payment confirmed manually";
    tone = "paid";
  } else if (tip > 0) {
    detail = `${dollars(paidOnline, true)} paid · ${dollars(tip, true)} tip`;
    tone = "tip";
  } else if (remaining > 0 && paidOnline > 0) {
    detail = `${dollars(paidOnline, true)} paid · ${dollars(remaining, true)} remaining`;
    tone = "deposit";
  } else if (paidOnline >= rental.priceCents) {
    detail = `${dollars(paidOnline, true)} paid online`;
    tone = "paid";
  }

  return <div className="payment-amount"><strong>{dollars(rental.priceCents, true)}</strong>{showDetails && <span className={`payment-detail payment-detail-${tone}`}>{detail}</span>}</div>;
}

function RentalTable({ rentals, employeeId }: { rentals: Rental[]; employeeId?: string }) {
  return (
    <Table className="rental-table">
      <TableHeader><TableRow><TableHead>Appointment</TableHead><TableHead>Category</TableHead><TableHead>Date & time</TableHead><TableHead>{employeeId ? "Price" : "Price / recorded payment"}</TableHead><TableHead>{employeeId ? "Your 30%" : "Assigned team"}</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
      <TableBody>
        {rentals.map((rental) => (
          <TableRow key={rental.id}>
            <TableCell><div className="rental-name"><strong>{rental.customer}</strong><span>{rental.title}</span></div></TableCell>
            <TableCell><CategoryBadge rental={rental} /></TableCell>
            <TableCell><div className="rental-date"><strong>{formatDate(rental.start, true)}</strong><span>{formatTime(rental.start)} · {durationLabel(rental)}</span></div></TableCell>
            <TableCell className="money-cell"><PaymentAmount rental={rental} showDetails={!employeeId} /></TableCell>
            <TableCell>
              {employeeId ? <strong className="share-amount">{dollars(rental.employeePayouts[employeeId]?.amountCents ?? 0, true)}</strong> : <div className="avatar-stack">{rental.assignedEmployeeIds.length ? rental.assignedEmployeeIds.map((id) => <span key={id} style={{ background: teamAccent(id) }}>{id.slice(0, 1).toUpperCase()}</span>) : <em>Unassigned</em>}</div>}
            </TableCell>
            <TableCell><StatusBadge state={appointmentStatus(rental, employeeId)} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function EmptyState({ title, copy }: { title: string; copy: string }) {
  return <div className="empty-state"><CalendarDays size={28} /><strong>{title}</strong><p>{copy}</p></div>;
}

function TeamSnapshot({ employees, rentals }: { employees: Employee[]; rentals: Rental[] }) {
  return (
    <section className="team-strip">
      <div className="team-strip-heading"><div><p className="eyebrow">Team pulse</p><h2>Earnings by employee</h2></div><Users size={20} /></div>
      <div className="team-strip-grid">
        {employees.map((employee) => {
          const assigned = rentals.filter((rental) => rental.assignedEmployeeIds.includes(employee.id));
          const owed = assigned.reduce((sum, rental) => sum + (rentalState(rental, employee.id) === "earned" ? rental.employeePayouts[employee.id]?.amountCents ?? 0 : 0), 0);
          const upcoming = assigned.filter((rental) => rentalState(rental, employee.id) === "upcoming").length;
          return <div className="employee-pulse" key={employee.id}><span className="employee-avatar" style={{ background: teamAccent(employee.id, employee.accent) }}>{employee.name.slice(0, 1)}</span><div><strong>{employee.name}</strong><span>{upcoming} upcoming</span></div><div><strong>{dollars(owed)}</strong><span>owed</span></div></div>;
        })}
      </div>
    </section>
  );
}

function TeamPage({ employees, rentals }: { employees: Employee[]; rentals: Rental[] }) {
  return (
    <div className="team-page-grid">
      {employees.map((employee) => {
        const assigned = rentals.filter((rental) => rental.assignedEmployeeIds.includes(employee.id));
        const paid = assigned.reduce((sum, rental) => sum + (rental.employeePayouts[employee.id]?.paid ? rental.employeePayouts[employee.id].amountCents : 0), 0);
        const owed = assigned.reduce((sum, rental) => sum + (rentalState(rental, employee.id) === "earned" ? rental.employeePayouts[employee.id]?.amountCents ?? 0 : 0), 0);
        const next = assigned.find((rental) => rentalState(rental, employee.id) === "upcoming");
        return (
          <article className="panel employee-card" key={employee.id}>
            <div className="employee-card-head"><span className="employee-avatar large" style={{ background: teamAccent(employee.id, employee.accent) }}>{employee.name.slice(0, 1)}</span><div><h2>{employee.name}</h2><p>{employee.email}</p></div><StatusBadge state={next ? "upcoming" : "paid"} /></div>
            <div className="employee-stats"><div><span>Earned</span><strong>{dollars(paid + owed)}</strong></div><div><span>Still owed</span><strong>{dollars(owed)}</strong></div><div><span>Appointments</span><strong>{assigned.length}</strong></div></div>
            <div className="employee-next"><CalendarDays size={16} /><span>Next accepted appointment</span><strong>{next ? formatDate(next.start, true) : "None scheduled"}</strong></div>
          </article>
        );
      })}
    </div>
  );
}

function PayoutPage({
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
}: {
  employeeId?: string;
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
  const payoutScopeLabel = selectedEmployee?.name ?? "All employees";
  const eligibleAppointments = rentals.filter((rental) => eligibleForPayout(rental, paidThrough, payoutEmployee)).length;
  return (
    <section className="payout-layout">
      <article className="panel payout-chart-panel">
        <div className="panel-heading"><div><p className="eyebrow">Weekly · monthly · yearly</p><h2>{isOwner ? "Team payouts" : "My payout history"}</h2></div></div>
        <div className="payout-summary"><div><span>{isOwner ? "Paid to team" : "Paid"}</span><strong>{dollars(metrics.paid)}</strong></div><div><span>Earned, unpaid</span><strong>{dollars(metrics.owed)}</strong></div><div><span>Projected</span><strong>{dollars(metrics.projected)}</strong></div></div>
        <div className="bar-chart-wrap">
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
        </div>
      </article>
      {isOwner ? (
        <article className="panel mark-paid-card">
          <div className="workflow-icon"><GitBranch size={24} /></div>
          <p className="eyebrow">Smooth action</p>
          <h2>Mark employee earnings paid</h2>
          <p>Choose who you paid and the last appointment date covered. The dashboard will update only that payout selection.</p>
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
          <small>You will stay inside the dashboard while the workflow runs.</small>
        </article>
      ) : (
        <article className="panel payout-rule-card">
          <div className="rule-number">30%</div>
          <p className="eyebrow">Your earning rule</p>
          <h2>Simple, consistent commission</h2>
          <p>You receive 30% of the appointment price for every accepted assignment, including studio rentals and other packages. It becomes earned only when the appointment is complete and the customer is fully paid.</p>
          <div className="rule-check"><Check size={16} /> Invitation accepted</div>
          <div className="rule-check"><Check size={16} /> Appointment completed</div>
          <div className="rule-check"><Check size={16} /> “Paid Online” meets or exceeds “Price”</div>
        </article>
      )}
    </section>
  );
}

function PaymentOverrideForm({
  open,
  onOpenChange,
  onContinue,
  reviewRentals,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContinue: (request: OwnerWorkflowRequest) => void;
  reviewRentals: Rental[];
}) {
  const [eventId, setEventId] = useState("");
  const [paidStatus, setPaidStatus] = useState<"true" | "false" | "clear">("true");

  useEffect(() => {
    if (!open) return;
    setEventId(reviewRentals[0]?.id ?? "");
    setPaidStatus("true");
  }, [open, reviewRentals]);

  const selected = reviewRentals.find((rental) => rental.id === eventId);
  const statusLabels = { true: "Payment received by invoice, cash, or other", false: "Not fully paid", clear: "Use Calendar payment fields" };
  const continueToConfirmation = () => {
    if (!selected) return;
    const recorded = selected.paidOnlineCents === null ? "None" : dollars(selected.paidOnlineCents, true);
    onOpenChange(false);
    onContinue({
      workflowId: "override-payment.yml",
      title: "Update customer payment",
      description: paidStatus === "true"
        ? "This confirms that the remaining balance was received by invoice, cash, or another method."
        : paidStatus === "false"
          ? "This records that the appointment is not fully paid."
          : "This removes the manual decision and returns the appointment to its Calendar payment status.",
      actionLabel: paidStatus === "true" ? "Confirm payment received" : paidStatus === "false" ? "Mark not fully paid" : "Clear manual status",
      inputs: { event_id: selected.id, paid_status: paidStatus },
      details: [
        { label: "Appointment", value: `${selected.customer} · ${selected.title}` },
        { label: "Date", value: `${formatDate(selected.start, true)} at ${formatTime(selected.start)}` },
        { label: "Price", value: dollars(selected.priceCents, true) },
        { label: "Calendar “Paid Online”", value: recorded },
        { label: "New status", value: statusLabels[paidStatus] },
      ],
    });
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="payment-override-dialog">
        <DialogHeader>
          <p className="eyebrow">Payment review</p>
          <DialogTitle>Update customer payment</DialogTitle>
          <DialogDescription>Only completed appointments with an unresolved balance appear here.</DialogDescription>
        </DialogHeader>
        {reviewRentals.length ? (
          <>
            <div className="workflow-form-field">
              <label htmlFor="payment-event">Appointment needing review</label>
              <select id="payment-event" onChange={(event) => setEventId(event.target.value)} value={eventId}>
                {reviewRentals.map((rental) => (
                  <option key={rental.id} value={rental.id}>
                    {formatDate(rental.start, true)} · {rental.customer} · {dollars(rental.priceCents, true)}
                  </option>
                ))}
              </select>
            </div>
            <div className="workflow-form-field">
              <label htmlFor="payment-status">Payment decision</label>
              <select id="payment-status" onChange={(event) => setPaidStatus(event.target.value as "true" | "false" | "clear")} value={paidStatus}>
                <option value="true">Payment received by invoice, cash, or other</option>
                <option value="false">Not fully paid</option>
                <option value="clear">Clear manual status</option>
              </select>
            </div>
            {selected && (
              <div className="payment-override-summary">
                <div><span>Price</span><strong>{dollars(selected.priceCents, true)}</strong></div>
                <div><span>Calendar “Paid Online”</span><strong>{selected.paidOnlineCents === null ? "None" : dollars(selected.paidOnlineCents, true)}</strong></div>
                <div><span>Remaining</span><strong>{dollars(Math.max(selected.priceCents - (selected.paidOnlineCents ?? 0), 0), true)}</strong></div>
              </div>
            )}
          </>
        ) : (
          <EmptyState copy="Every completed appointment currently has its full payment recorded." title="No payment review needed" />
        )}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">{selected ? "Cancel" : "Close"}</Button>
          {selected && <Button className="workflow-run-button" onClick={continueToConfirmation}>Continue</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DashboardView({ payload, dark, setDark, onLogout }: { payload: DashboardPayload; dark: boolean; setDark: (value: boolean) => void; onLogout: () => void }) {
  const [view, setView] = useState<ViewKey>("overview");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all");
  const [paidThrough, setPaidThrough] = useState(new Date().toISOString().slice(0, 10));
  const [payoutEmployee, setPayoutEmployee] = useState("all");
  const [paymentOverrideOpen, setPaymentOverrideOpen] = useState(false);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [workflowRequest, setWorkflowRequest] = useState<OwnerWorkflowRequest | null>(null);
  const isOwner = payload.role === "owner";
  const employeeId = isOwner ? undefined : payload.user.id;
  const rentals = useMemo(() => [...payload.rentals].sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime()), [payload.rentals]);
  const visibleRentals = useMemo(() => employeeId ? rentals.filter((rental) => rental.assignedEmployeeIds.includes(employeeId)) : rentals, [employeeId, rentals]);
  const categoryOptions = useMemo(() => APPOINTMENT_CATEGORIES.filter((category) => visibleRentals.some((rental) => appointmentCategory(rental).id === category.id)), [visibleRentals]);
  const filteredRentals = useMemo(() => visibleRentals.filter((rental) =>
    (categoryFilter === "all" || appointmentCategory(rental).id === categoryFilter)
    && (paymentFilter === "all" || customerPaymentState(rental) === paymentFilter),
  ), [categoryFilter, paymentFilter, visibleRentals]);
  const reviewRentals = useMemo(() => rentals.filter((rental) => customerPaymentState(rental) === "review"), [rentals]);
  const upcoming = useMemo(() => [...visibleRentals].filter((rental) => rentalState(rental, employeeId) === "upcoming").reverse(), [employeeId, visibleRentals]);

  const metrics = useMemo(() => {
    let revenue = 0;
    let owed = 0;
    let paid = 0;
    let projected = 0;
    for (const rental of visibleRentals) {
      revenue += recognizedRevenue(rental);
      const payouts = employeeId ? [rental.employeePayouts[employeeId]].filter(Boolean) : Object.values(rental.employeePayouts);
      for (const payout of payouts) {
        const state = rentalState(rental, employeeId);
        if (payout.paid) paid += payout.amountCents;
        else if (state === "earned") owed += payout.amountCents;
        else if (state === "upcoming") projected += payout.amountCents;
      }
    }
    return { revenue, owed, paid, projected };
  }, [employeeId, visibleRentals]);

  const monthly = useMemo(() => {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((month) => ({ month, revenue: 0, payroll: 0, paid: 0, owed: 0 }));
    for (const rental of visibleRentals) {
      const month = new Date(rental.start).getUTCMonth();
      months[month].revenue += recognizedRevenue(rental);
      const payouts = employeeId ? [rental.employeePayouts[employeeId]].filter(Boolean) : Object.values(rental.employeePayouts);
      for (const payout of payouts) {
        months[month].payroll += payout.amountCents;
        if (payout.paid) months[month].paid += payout.amountCents;
        else if (rentalState(rental, employeeId) === "earned") months[month].owed += payout.amountCents;
      }
    }
    return months;
  }, [employeeId, visibleRentals]);

  const recent = visibleRentals.slice(0, 6);
  const navItems = NAV_ITEMS.filter((item) => !item.ownerOnly || isOwner);
  const displayName = payload.user.name;

  const openWorkflow = (request: OwnerWorkflowRequest) => {
    setWorkflowRequest(request);
    window.setTimeout(() => setWorkflowOpen(true), 0);
  };

  const openPayoutWorkflow = () => {
    const selectedEmployee = payload.employees.find((employee) => employee.id === payoutEmployee);
    const employeeLabel = selectedEmployee?.name ?? `All ${payload.employees.length} employees`;
    const eligible = rentals.filter((rental) => eligibleForPayout(rental, paidThrough, payoutEmployee)).length;
    openWorkflow({
      workflowId: "mark-paid.yml",
      title: "Mark employee earnings paid",
      description: selectedEmployee
        ? `This marks ${selectedEmployee.name}'s eligible earnings paid through the selected date and republishes the encrypted dashboards.`
        : "This marks every eligible employee earning paid through the selected date and republishes the encrypted dashboards.",
      actionLabel: "Mark earnings paid",
      inputs: { paid_through: paidThrough, employee: payoutEmployee },
      details: [
        { label: "Paid through", value: paidThrough },
        { label: "Employee selection", value: employeeLabel },
        { label: "Eligible appointments", value: String(eligible) },
      ],
    });
  };

  const openCalendarSync = () => openWorkflow({
    workflowId: "calendar-sync.yml",
    title: "Sync the Smooth Studios Calendar",
    description: "This imports the latest Calendar changes, rebuilds every encrypted dashboard, and republishes the portal.",
    actionLabel: "Start Calendar sync",
    details: [
      { label: "Calendar", value: payload.calendarName },
      { label: "Import range", value: "January 1, 2026 through today" },
      { label: "Current data generated", value: `${formatDate(payload.generatedAt, true)} at ${formatTime(payload.generatedAt)}` },
    ],
  });

  const openPaymentOverride = () => {
    if (reviewRentals.length) setPaymentOverrideOpen(true);
  };
  const reviewPayments = () => {
    setCategoryFilter("all");
    setPaymentFilter("review");
    setView("rentals");
  };

  return (
    <SidebarProvider>
      <Sidebar className="dashboard-sidebar" collapsible="offcanvas">
        <SidebarHeader className="sidebar-brand"><Logo compact /><span className={`calendar-dot ${payload.source === "sample" ? "preview" : ""}`}><span /> {payload.source === "sample" ? "Preview data loaded" : "Calendar connected"}</span></SidebarHeader>
        <SidebarContent>
          <SidebarGroup><SidebarGroupContent><SidebarMenu className="studio-nav">
            {navItems.map((item) => <SidebarMenuItem key={item.key}><SidebarMenuButton isActive={view === item.key} onClick={() => setView(item.key)} tooltip={item.label}><item.icon /><span>{item.label}</span></SidebarMenuButton></SidebarMenuItem>)}
          </SidebarMenu></SidebarGroupContent></SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="studio-sidebar-footer">
          <ThemeControl dark={dark} onChange={setDark} />
          <div className="sidebar-user"><span className="user-avatar" style={{ background: teamAccent(payload.user.id, payload.user.accent) }}>{displayName.slice(0, 1)}</span><div><strong>{displayName}</strong><span>{isOwner ? "Studio dashboard" : "Team member"}</span></div><button aria-label="Log out" onClick={onLogout}><LogOut size={16} /></button></div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="dashboard-main">
        <header className="dashboard-topbar">
          <div className="topbar-title"><SidebarTrigger className="mobile-menu-trigger"><Menu /></SidebarTrigger><div><p>{isOwner ? "Smooth dashboard" : "My dashboard"}</p><h1>{view === "overview" ? `Good ${new Date().getHours() < 12 ? "morning" : "evening"}, ${displayName}` : NAV_ITEMS.find((item) => item.key === view)?.label}</h1></div></div>
          <div className="topbar-actions">{payload.source === "sample" && <Badge className="sample-badge" variant="outline">Preview data</Badge>}{isOwner && <Button className="sync-now-button" onClick={openCalendarSync} size="sm" variant="outline"><RefreshCw size={15} /><span>Sync now</span></Button>}<div className="date-chip"><CalendarDays size={15} /><span>Jan–Dec 2026</span></div></div>
        </header>

        <div className="dashboard-content">
          {view === "overview" && (
            <>
              <section className="kpi-grid">
                {isOwner ? <><KpiCard icon={CircleDollarSign} label="Total revenue" note="All fully paid appointments" tone="red" value={dollars(metrics.revenue)} /><KpiCard icon={Banknote} label="Payroll owed" note="Earned, not yet paid" tone="amber" value={dollars(metrics.owed)} /><KpiCard icon={ShieldCheck} label="Paid to team" note="Recorded employee payouts" tone="green" value={dollars(metrics.paid)} /><KpiCard icon={CalendarDays} label="Upcoming appointments" note={`${upcoming.length} accepted assignments`} tone="blue" value={String(upcoming.length)} /></> : <><KpiCard icon={Banknote} label="Earned, not paid" note="Completed + customer paid" tone="red" value={dollars(metrics.owed)} /><KpiCard icon={Clock3} label="Projected earnings" note="From upcoming appointments" tone="amber" value={dollars(metrics.projected)} /><KpiCard icon={ShieldCheck} label="Paid this year" note="Payouts marked complete" tone="green" value={dollars(metrics.paid)} /><KpiCard icon={CalendarDays} label="Upcoming appointments" note={upcoming[0] ? `Next: ${formatDate(upcoming[0].start, true)}` : "Nothing scheduled"} tone="blue" value={String(upcoming.length)} /></>}
              </section>
              <PeriodTotals employeeId={employeeId} rentals={visibleRentals} />
              {isOwner && <CategoryRevenue rentals={visibleRentals} />}
              {isOwner && <PaymentReview onOpen={reviewPayments} onOverride={openPaymentOverride} rentals={visibleRentals} />}

              <section className="overview-grid">
                <article className="panel trend-panel">
                  <div className="panel-heading"><div><p className="eyebrow">2026 performance</p><h2>{isOwner ? "Revenue & payroll" : "My earnings"}</h2></div><div className="chart-legend"><span className="legend-red" />{isOwner ? "Revenue" : "Paid"}<span className="legend-dark" />{isOwner ? "Payroll" : "Owed"}</div></div>
                  <div className="chart-wrap"><ResponsiveContainer height="100%" width="100%"><AreaChart data={monthly} margin={{ left: -18, right: 6, top: 12, bottom: 0 }}><defs><linearGradient id="redFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#e10000" stopOpacity={0.24} /><stop offset="100%" stopColor="#e10000" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 6" vertical={false} /><XAxis axisLine={false} dataKey="month" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickLine={false} /><YAxis axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(value) => `$${value / 100}`} tickLine={false} /><Tooltip content={<ChartTooltip />} /><Area dataKey={isOwner ? "payroll" : "owed"} fill="transparent" name={isOwner ? "Payroll" : "Owed"} stroke="#27272a" strokeDasharray="5 5" strokeWidth={2} type="monotone" /><Area dataKey={isOwner ? "revenue" : "paid"} fill="url(#redFill)" name={isOwner ? "Revenue" : "Paid"} stroke="#e10000" strokeWidth={3} type="monotone" /></AreaChart></ResponsiveContainer></div>
                </article>
                <article className="panel upcoming-panel">
                  <div className="panel-heading"><div><p className="eyebrow">On the calendar</p><h2>Coming up</h2></div><button onClick={() => setView("rentals")}>View all <ChevronRight size={15} /></button></div>
                  <div className="upcoming-list">{upcoming.length ? upcoming.slice(0, 4).map((rental) => <div className="upcoming-item" key={rental.id}><div className="date-block"><strong>{new Date(rental.start).getDate()}</strong><span>{formatDate(rental.start, true).slice(0, 3)}</span></div><div className="upcoming-copy"><strong>{rental.customer}</strong><span>{formatTime(rental.start)} · {durationLabel(rental)}</span></div><div className="upcoming-value"><strong>{dollars(employeeId ? rental.employeePayouts[employeeId]?.amountCents ?? 0 : rental.priceCents)}</strong><span>{employeeId ? "your 30%" : "appointment"}</span></div></div>) : <EmptyState copy="Accepted Calendar assignments will appear here." title="No upcoming appointments" />}</div>
                </article>
              </section>

              {isOwner && <TeamSnapshot employees={payload.employees} rentals={rentals} />}
              <article className="panel rentals-panel"><div className="panel-heading"><div><p className="eyebrow">Latest activity</p><h2>Appointment history</h2></div><button onClick={() => setView("rentals")}>View all <ChevronRight size={15} /></button></div>{recent.length ? <RentalTable employeeId={employeeId} rentals={recent} /> : <EmptyState copy="Calendar appointments will appear after the first sync." title="No appointment history yet" />}</article>
            </>
          )}

          {view === "rentals" && <article className="panel page-panel">
            <div className="panel-heading page-heading">
              <div><p className="eyebrow">Beginning January 1, 2026</p><h2>{isOwner ? "All appointments" : "My accepted appointments"}</h2><p>{isOwner ? "Revenue includes every fully paid appointment—even when no employee is assigned." : "Only appointments accepted from one of your Google emails appear here."}</p></div>
              <div className="page-actions">
                <Select onValueChange={setCategoryFilter} value={categoryFilter}>
                  <SelectTrigger aria-label="Filter appointments by category" className="category-select"><SelectValue placeholder="All categories" /></SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="all">All categories</SelectItem>
                    {categoryOptions.map((category) => <SelectItem key={category.id} value={category.id}>{category.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select onValueChange={(value) => setPaymentFilter(value as PaymentFilter)} value={paymentFilter}>
                  <SelectTrigger aria-label="Filter appointments by payment status" className="category-select payment-select"><SelectValue placeholder="All payments" /></SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="all">All payments</SelectItem>
                    <SelectItem value="paid">Fully paid</SelectItem>
                    <SelectItem value="deposit">Upcoming deposits</SelectItem>
                    <SelectItem value="review">Needs payment review</SelectItem>
                    <SelectItem value="pending">Payment pending</SelectItem>
                  </SelectContent>
                </Select>
                <Badge className="count-badge" variant="secondary">{filteredRentals.length} appointment{filteredRentals.length === 1 ? "" : "s"}</Badge>
                {isOwner && reviewRentals.length > 0 && <Button onClick={openPaymentOverride} size="sm" variant="outline"><GitBranch size={14} /> Record payment received</Button>}
              </div>
            </div>
            {filteredRentals.length ? <RentalTable employeeId={employeeId} rentals={filteredRentals} /> : <EmptyState copy={categoryFilter === "all" && paymentFilter === "all" ? "Accepted appointments will appear after the 30-minute Calendar sync." : "No appointments match the selected filters."} title="No appointments found" />}
          </article>}
          {view === "team" && isOwner && <TeamPage employees={payload.employees} rentals={rentals} />}
          {view === "payouts" && <PayoutPage employeeId={employeeId} employees={payload.employees} metrics={metrics} monthly={monthly} onContinue={openPayoutWorkflow} paidThrough={paidThrough} payoutEmployee={payoutEmployee} rentals={visibleRentals} setPaidThrough={setPaidThrough} setPayoutEmployee={setPayoutEmployee} />}
        </div>
      </SidebarInset>
      {isOwner && (
        <>
          <PaymentOverrideForm onContinue={openWorkflow} onOpenChange={setPaymentOverrideOpen} open={paymentOverrideOpen} reviewRentals={reviewRentals} />
          <GithubWorkflowDialog access={payload.workflowAccess} onOpenChange={setWorkflowOpen} open={workflowOpen} request={workflowRequest} />
        </>
      )}
    </SidebarProvider>
  );
}

export function SmoothDashboard() {
  const [profiles, setProfiles] = useState<AccessProfile[]>(FALLBACK_PROFILES);
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const savedTheme = localStorage.getItem("smooth-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const themeTimer = window.setTimeout(() => setDark(savedTheme ? savedTheme === "dark" : prefersDark), 0);
    fetch("./data/access.json").then((response) => response.ok ? response.json() : Promise.reject()).then((data: { profiles: AccessProfile[] }) => setProfiles(data.profiles)).catch(() => setProfiles(FALLBACK_PROFILES));
    return () => window.clearTimeout(themeTimer);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("smooth-theme", dark ? "dark" : "light");
  }, [dark]);

  const unlock = async (profile: AccessProfile, password: string) => {
    const response = await fetch(`./data/${profile.id}.json`, { cache: "no-store" });
    if (!response.ok) throw new Error("Dashboard data is unavailable");
    const envelope = await response.json() as EncryptedEnvelope;
    const unlocked = await decryptDashboard(envelope, password);
    if (unlocked.user.id !== profile.id || unlocked.role !== profile.role) throw new Error("Invalid dashboard payload");
    setPayload(unlocked);
  };

  if (!payload) return <LoginScreen onUnlock={unlock} profiles={profiles} />;
  return <DashboardView dark={dark} onLogout={() => setPayload(null)} payload={payload} setDark={setDark} />;
}
