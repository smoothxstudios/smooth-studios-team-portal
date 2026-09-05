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
  ShieldCheck,
  Sun,
  Users,
  WalletCards,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import type {
  AccessProfile,
  DashboardPayload,
  Employee,
  EncryptedEnvelope,
  Rental,
} from "@/lib/dashboard-types";

const FALLBACK_PROFILES: AccessProfile[] = [
  { id: "owner", label: "Owner", role: "owner" },
  { id: "akiva", label: "Akiva", role: "employee" },
  { id: "jordyn", label: "Jordyn", role: "employee" },
  { id: "rayne", label: "Rayne", role: "employee" },
];
const REPOSITORY_URL = "https://github.com/smoothxstudios/smooth-studios-team-portal";
const PAYOUT_WORKFLOW_URL = `${REPOSITORY_URL}/actions/workflows/mark-paid.yml`;
const PAYMENT_OVERRIDE_WORKFLOW_URL = `${REPOSITORY_URL}/actions/workflows/override-payment.yml`;
const STUDIO_TIME_ZONE = "America/New_York";
const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const MONEY_EXACT = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

type ViewKey = "overview" | "rentals" | "team" | "payouts";
type RentalState = "upcoming" | "earned" | "paid" | "awaiting";

const NAV_ITEMS: { key: ViewKey; label: string; icon: typeof LayoutDashboard; ownerOnly?: boolean }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "rentals", label: "Rentals", icon: CalendarDays },
  { key: "team", label: "Team", icon: Users, ownerOnly: true },
  { key: "payouts", label: "Payouts", icon: WalletCards },
];

function dollars(cents: number, exact = false) {
  return (exact ? MONEY_EXACT : MONEY).format(cents / 100);
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

function rentalState(rental: Rental, employeeId?: string): RentalState {
  const ended = new Date(rental.end).getTime() <= Date.now();
  if (!ended) return "upcoming";
  if (!rental.fullyPaid) return "awaiting";
  if (employeeId && rental.employeePayouts[employeeId]?.paid) return "paid";
  return "earned";
}

function StatusBadge({ state }: { state: RentalState }) {
  const labels = { upcoming: "Upcoming", earned: "Earned", paid: "Paid out", awaiting: "Awaiting customer" };
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
      if (!rental.fullyPaid || new Date(rental.end) > now) return 0;
      return rental.employeePayouts[employeeId]?.amountCents ?? 0;
    }
    return rental.fullyPaid ? rental.priceCents : 0;
  };
  const secondaryFor = (rental: Rental) => {
    if (!rental.fullyPaid || new Date(rental.end) > now) return 0;
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
            <small>{employeeId ? `${secondary} completed rental${secondary === 1 ? "" : "s"}` : `${dollars(secondary)} earned payroll`}</small>
            <em className={change !== null && change < 0 ? "down" : ""}>{change === null ? "No prior comparison" : `${change >= 0 ? "+" : ""}${change}% vs prior`}</em>
          </div>
        );
      })}
    </section>
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><p>{label}</p>{payload.map((item) => <div key={item.name}><span style={{ background: item.color }} />{item.name}<strong>{dollars(item.value)}</strong></div>)}</div>;
}

function RentalTable({ rentals, employeeId }: { rentals: Rental[]; employeeId?: string }) {
  return (
    <Table className="rental-table">
      <TableHeader><TableRow><TableHead>Rental</TableHead><TableHead>Date & time</TableHead><TableHead>Rental price</TableHead><TableHead>{employeeId ? "Your 30%" : "Assigned team"}</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
      <TableBody>
        {rentals.map((rental) => (
          <TableRow key={rental.id}>
            <TableCell><div className="rental-name"><strong>{rental.customer}</strong><span>{rental.title}</span></div></TableCell>
            <TableCell><div className="rental-date"><strong>{formatDate(rental.start, true)}</strong><span>{formatTime(rental.start)} · {durationLabel(rental)}</span></div></TableCell>
            <TableCell className="money-cell">{dollars(rental.priceCents, true)}</TableCell>
            <TableCell>
              {employeeId ? <strong className="share-amount">{dollars(rental.employeePayouts[employeeId]?.amountCents ?? 0, true)}</strong> : <div className="avatar-stack">{rental.assignedEmployeeIds.length ? rental.assignedEmployeeIds.map((id) => <span key={id}>{id.slice(0, 1).toUpperCase()}</span>) : <em>Unassigned</em>}</div>}
            </TableCell>
            <TableCell><StatusBadge state={rentalState(rental, employeeId)} /></TableCell>
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
          return <div className="employee-pulse" key={employee.id}><span className="employee-avatar" style={{ background: employee.accent }}>{employee.name.slice(0, 1)}</span><div><strong>{employee.name}</strong><span>{upcoming} upcoming</span></div><div><strong>{dollars(owed)}</strong><span>owed</span></div></div>;
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
            <div className="employee-card-head"><span className="employee-avatar large" style={{ background: employee.accent }}>{employee.name.slice(0, 1)}</span><div><h2>{employee.name}</h2><p>{employee.email}</p></div><StatusBadge state={next ? "upcoming" : "paid"} /></div>
            <div className="employee-stats"><div><span>Earned</span><strong>{dollars(paid + owed)}</strong></div><div><span>Still owed</span><strong>{dollars(owed)}</strong></div><div><span>Rentals</span><strong>{assigned.length}</strong></div></div>
            <div className="employee-next"><CalendarDays size={16} /><span>Next accepted rental</span><strong>{next ? formatDate(next.start, true) : "None scheduled"}</strong></div>
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
  rentals,
  setPaidThrough,
}: {
  employeeId?: string;
  employees: Employee[];
  metrics: { revenue: number; owed: number; paid: number; projected: number };
  monthly: Array<{ month: string; paid: number; owed: number }>;
  onContinue: () => void;
  paidThrough: string;
  rentals: Rental[];
  setPaidThrough: (value: string) => void;
}) {
  const isOwner = !employeeId;
  return (
    <section className="payout-layout">
      <article className="panel payout-chart-panel">
        <div className="panel-heading"><div><p className="eyebrow">Weekly · monthly · yearly</p><h2>{isOwner ? "Paid versus unpaid earnings" : "My payout history"}</h2></div></div>
        <div className="payout-summary"><div><span>Paid</span><strong>{dollars(metrics.paid)}</strong></div><div><span>Earned, unpaid</span><strong>{dollars(metrics.owed)}</strong></div><div><span>Projected</span><strong>{dollars(metrics.projected)}</strong></div></div>
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
          <p className="eyebrow">Owner action</p>
          <h2>Mark employee earnings paid</h2>
          <p>Choose the last rental date covered by your payout. GitHub will authenticate you and securely update the encrypted ledger.</p>
          <label htmlFor="paid-through">Mark everything paid through</label>
          <input id="paid-through" max={new Date().toISOString().slice(0, 10)} onChange={(event) => setPaidThrough(event.target.value)} type="date" value={paidThrough} />
          <div className="workflow-scope"><ReceiptText size={16} /><span>{employees.length} employees · {rentals.filter((rental) => new Date(rental.end) <= new Date(`${paidThrough}T23:59:59`)).length} eligible rentals</span></div>
          <Button className="github-button" onClick={onContinue}>Continue in GitHub <ArrowRight size={16} /></Button>
          <small>The selected date is copied for the workflow form. GitHub sign-in is required.</small>
        </article>
      ) : (
        <article className="panel payout-rule-card">
          <div className="rule-number">30%</div>
          <p className="eyebrow">Your earning rule</p>
          <h2>Simple, consistent commission</h2>
          <p>You receive 30% of the rental price for every accepted assignment. It becomes earned only when the rental is complete and the customer is fully paid.</p>
          <div className="rule-check"><Check size={16} /> Invitation accepted</div>
          <div className="rule-check"><Check size={16} /> Rental completed</div>
          <div className="rule-check"><Check size={16} /> “Paid Online” matches “Price”</div>
        </article>
      )}
    </section>
  );
}

function DashboardView({ payload, dark, setDark, onLogout }: { payload: DashboardPayload; dark: boolean; setDark: (value: boolean) => void; onLogout: () => void }) {
  const [view, setView] = useState<ViewKey>("overview");
  const [paidThrough, setPaidThrough] = useState(new Date().toISOString().slice(0, 10));
  const isOwner = payload.role === "owner";
  const employeeId = isOwner ? undefined : payload.user.id;
  const rentals = useMemo(() => [...payload.rentals].sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime()), [payload.rentals]);
  const visibleRentals = useMemo(() => employeeId ? rentals.filter((rental) => rental.assignedEmployeeIds.includes(employeeId)) : rentals, [employeeId, rentals]);
  const upcoming = useMemo(() => [...visibleRentals].filter((rental) => rentalState(rental, employeeId) === "upcoming").reverse(), [employeeId, visibleRentals]);

  const metrics = useMemo(() => {
    let revenue = 0;
    let owed = 0;
    let paid = 0;
    let projected = 0;
    for (const rental of visibleRentals) {
      if (rental.fullyPaid) revenue += rental.priceCents;
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
      if (rental.fullyPaid) months[month].revenue += rental.priceCents;
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

  const continueToGithub = () => {
    navigator.clipboard?.writeText(paidThrough).catch(() => undefined);
    window.open(PAYOUT_WORKFLOW_URL, "_blank", "noopener,noreferrer");
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
          <div className="sidebar-user"><span className="user-avatar">{displayName.slice(0, 1)}</span><div><strong>{displayName}</strong><span>{isOwner ? "Studio owner" : "Team member"}</span></div><button aria-label="Log out" onClick={onLogout}><LogOut size={16} /></button></div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="dashboard-main">
        <header className="dashboard-topbar">
          <div className="topbar-title"><SidebarTrigger className="mobile-menu-trigger"><Menu /></SidebarTrigger><div><p>{isOwner ? "Owner dashboard" : "My dashboard"}</p><h1>{view === "overview" ? `Good ${new Date().getHours() < 12 ? "morning" : "evening"}, ${displayName}` : NAV_ITEMS.find((item) => item.key === view)?.label}</h1></div></div>
          <div className="topbar-actions">{payload.source === "sample" && <Badge className="sample-badge" variant="outline">Preview data</Badge>}<div className="date-chip"><CalendarDays size={15} /><span>Jan–Dec 2026</span></div></div>
        </header>

        <div className="dashboard-content">
          {view === "overview" && (
            <>
              <section className="kpi-grid">
                {isOwner ? <><KpiCard icon={CircleDollarSign} label="Paid rental revenue" note="All fully paid rentals" tone="red" value={dollars(metrics.revenue)} /><KpiCard icon={Banknote} label="Payroll owed" note="Earned, not yet paid" tone="amber" value={dollars(metrics.owed)} /><KpiCard icon={ShieldCheck} label="Paid to team" note="Recorded employee payouts" tone="green" value={dollars(metrics.paid)} /><KpiCard icon={CalendarDays} label="Upcoming rentals" note={`${upcoming.length} accepted assignments`} tone="blue" value={String(upcoming.length)} /></> : <><KpiCard icon={Banknote} label="Earned, not paid" note="Completed + customer paid" tone="red" value={dollars(metrics.owed)} /><KpiCard icon={Clock3} label="Projected earnings" note="From upcoming rentals" tone="amber" value={dollars(metrics.projected)} /><KpiCard icon={ShieldCheck} label="Paid this year" note="Payouts marked complete" tone="green" value={dollars(metrics.paid)} /><KpiCard icon={CalendarDays} label="Upcoming rentals" note={upcoming[0] ? `Next: ${formatDate(upcoming[0].start, true)}` : "Nothing scheduled"} tone="blue" value={String(upcoming.length)} /></>}
              </section>
              <PeriodTotals employeeId={employeeId} rentals={visibleRentals} />

              <section className="overview-grid">
                <article className="panel trend-panel">
                  <div className="panel-heading"><div><p className="eyebrow">2026 performance</p><h2>{isOwner ? "Revenue & payroll" : "My earnings"}</h2></div><div className="chart-legend"><span className="legend-red" />{isOwner ? "Revenue" : "Paid"}<span className="legend-dark" />{isOwner ? "Payroll" : "Owed"}</div></div>
                  <div className="chart-wrap"><ResponsiveContainer height="100%" width="100%"><AreaChart data={monthly} margin={{ left: -18, right: 6, top: 12, bottom: 0 }}><defs><linearGradient id="redFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#e10000" stopOpacity={0.24} /><stop offset="100%" stopColor="#e10000" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 6" vertical={false} /><XAxis axisLine={false} dataKey="month" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickLine={false} /><YAxis axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(value) => `$${value / 100}`} tickLine={false} /><Tooltip content={<ChartTooltip />} /><Area dataKey={isOwner ? "payroll" : "owed"} fill="transparent" name={isOwner ? "Payroll" : "Owed"} stroke="#27272a" strokeDasharray="5 5" strokeWidth={2} type="monotone" /><Area dataKey={isOwner ? "revenue" : "paid"} fill="url(#redFill)" name={isOwner ? "Revenue" : "Paid"} stroke="#e10000" strokeWidth={3} type="monotone" /></AreaChart></ResponsiveContainer></div>
                </article>
                <article className="panel upcoming-panel">
                  <div className="panel-heading"><div><p className="eyebrow">On the calendar</p><h2>Coming up</h2></div><button onClick={() => setView("rentals")}>View all <ChevronRight size={15} /></button></div>
                  <div className="upcoming-list">{upcoming.length ? upcoming.slice(0, 4).map((rental) => <div className="upcoming-item" key={rental.id}><div className="date-block"><strong>{new Date(rental.start).getDate()}</strong><span>{formatDate(rental.start, true).slice(0, 3)}</span></div><div className="upcoming-copy"><strong>{rental.customer}</strong><span>{formatTime(rental.start)} · {durationLabel(rental)}</span></div><div className="upcoming-value"><strong>{dollars(employeeId ? rental.employeePayouts[employeeId]?.amountCents ?? 0 : rental.priceCents)}</strong><span>{employeeId ? "your 30%" : "rental"}</span></div></div>) : <EmptyState copy="Accepted Calendar assignments will appear here." title="No upcoming rentals" />}</div>
                </article>
              </section>

              {isOwner && <TeamSnapshot employees={payload.employees} rentals={rentals} />}
              <article className="panel rentals-panel"><div className="panel-heading"><div><p className="eyebrow">Latest activity</p><h2>Rental history</h2></div><button onClick={() => setView("rentals")}>View all <ChevronRight size={15} /></button></div>{recent.length ? <RentalTable employeeId={employeeId} rentals={recent} /> : <EmptyState copy="Calendar rentals will appear after the first sync." title="No rental history yet" />}</article>
            </>
          )}

          {view === "rentals" && <article className="panel page-panel"><div className="panel-heading page-heading"><div><p className="eyebrow">Beginning January 1, 2026</p><h2>{isOwner ? "Every studio rental" : "My accepted rentals"}</h2><p>{isOwner ? "Revenue includes every fully paid rental—even when no employee is assigned." : "Only invitations accepted from your Google email appear here."}</p></div><div className="page-actions"><Badge className="count-badge" variant="secondary">{visibleRentals.length} rentals</Badge>{isOwner && <Button onClick={() => window.open(PAYMENT_OVERRIDE_WORKFLOW_URL, "_blank", "noopener,noreferrer")} size="sm" variant="outline"><GitBranch size={14} /> Payment override</Button>}</div></div>{visibleRentals.length ? <RentalTable employeeId={employeeId} rentals={visibleRentals} /> : <EmptyState copy="Your accepted rentals will appear after the hourly Calendar sync." title="No rentals found" />}</article>}
          {view === "team" && isOwner && <TeamPage employees={payload.employees} rentals={rentals} />}
          {view === "payouts" && <PayoutPage employeeId={employeeId} employees={payload.employees} metrics={metrics} monthly={monthly} onContinue={continueToGithub} paidThrough={paidThrough} rentals={visibleRentals} setPaidThrough={setPaidThrough} />}
        </div>
      </SidebarInset>
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
