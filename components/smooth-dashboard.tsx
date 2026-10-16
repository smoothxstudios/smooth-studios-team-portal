"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DashboardRefreshProvider, PullToRefresh, useRefreshSource } from "@/components/dashboard-refresh";
import { refreshDashboardSnapshot } from "@/lib/dashboard-refresh.mjs";
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
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  CalendarCheck,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  Check,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Clock3,
  Eye,
  EyeOff,
  ExternalLink,
  Fingerprint,
  FolderOpen,
  GitBranch,
  House,
  Landmark,
  LayoutDashboard,
  Link2,
  LockKeyhole,
  LogOut,
  Menu,
  ReceiptText,
  Search,
  Settings,
  TriangleAlert,
  Users,
  WalletCards,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { decryptDashboard } from "@/lib/dashboard-crypto";
import { encryptWorkflowPayload } from "@/lib/dashboard-crypto";
import { APPOINTMENT_CATEGORIES, categorizeAppointment } from "@/lib/appointment-categories.mjs";
import { GithubWorkflowDialog, type OwnerWorkflowRequest } from "@/components/github-workflow-dialog";
import { StudioGuidePage } from "@/components/studio-guide";
import { createGuidePatch, MAX_GUIDELINE_UPDATE_BYTES } from "@/lib/studio-guidelines.mjs";
import { TeamAccountSetup, type NewTeamSettings } from "@/components/team-account-setup";
import { TEAM, studioLocal } from "@/lib/team-schedule.mjs";
import { employeeEarningsForYear } from "@/lib/employee-home.mjs";
import { customerFullyPaid, tipAmount, recognizedRevenue, ownerPeriodFinances } from "@/lib/owner-finances.mjs";
import { TeamSchedulingPage } from "@/components/team-scheduling";
import { DashboardSettings } from "@/components/dashboard-settings";
import { StudioInfoPage } from "@/components/studio-info";
import { CreativeWorkPage, CreativeWorkPreview } from "@/components/creative-work";
import { AlertsPage, UnreadBadge } from "@/components/alerts";
import { MobileToolbar } from "@/components/mobile-toolbar";
import { useAlerts, type DashboardAlert } from "@/lib/use-alerts";
import { usePayroll } from "@/lib/use-payroll";
import { applyRentalAdvances } from "@/lib/payroll-advances.mjs";
import type { PayrollState } from "@/lib/dashboard-types";
import { useCreativeWork, type CreativeAssignment } from "@/lib/use-creative-work";
import { creativeEarnings, creativeEarningDate } from "@/lib/creative-work.mjs";
import { rememberProfile, rememberedProfile, quickSignInRecord, quickSignInPassword, quickSignInError } from "@/lib/quick-sign-in.mjs";
import { EmployeeEngagementBar, EmployeeEngagementProvider, SmoothStarSidebar, TeamEngagementReview } from "@/components/team-engagement";
import { DashboardVersionFooter } from "@/components/dashboard-version-footer";
import { teamToken } from "@/lib/team-auth.mjs";
import { disableTeamPush } from "@/lib/team-api";
import type {
  AccessProfile,
  DashboardPayload,
  Employee,
  EmployeePayout,
  EncryptedEnvelope,
  Rental,
  StripeSummary,
  StudioGuideline,
  UnmatchedStripePayment,
} from "@/lib/dashboard-types";

const FALLBACK_PROFILES: AccessProfile[] = TEAM.map(person => ({ id: person.id, label: person.name, role: person.id === "owner" ? "owner" : "employee" }));
const TEAM_ACCENTS: Record<string, string> = Object.fromEntries(TEAM.map(person => [person.id, person.color]));
const STUDIO_TIME_ZONE = "America/New_York";
const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const MONEY_EXACT = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

type ViewKey = "alerts" | "overview" | "rentals" | "team" | "payouts" | "guide" | "checklists" | "scheduling" | "availability" | "creative" | "settings";
type RentalState = "upcoming" | "earned" | "paid" | "awaiting";
type CustomerPaymentState = "paid" | "deposit" | "review" | "pending";
type AppointmentStatus = RentalState | "customer-paid" | "upcoming-paid" | "deposit" | "review";
type PaymentFilter = "all" | CustomerPaymentState;

type NavigationGroup = "home" | "work" | "management" | "resources" | "settings";
type NavigationItem = { key: ViewKey; label: string; icon: typeof LayoutDashboard; group: NavigationGroup; ownerOnly?: boolean };

const NAV_ITEMS: NavigationItem[] = [
  { key: "overview", label: "Home", icon: House, group: "home" },
  { key: "alerts", label: "Alerts", icon: Bell, group: "home" },
  { key: "scheduling", label: "Team Schedule", icon: CalendarDays, group: "work" },
  { key: "availability", label: "Availability", icon: CalendarCheck, group: "work" },
  { key: "creative", label: "Creative Work", icon: ClipboardList, group: "work" },
  { key: "rentals", label: "Appointments", icon: CalendarClock, group: "management", ownerOnly: true },
  { key: "team", label: "Team", icon: Users, group: "management", ownerOnly: true },
  { key: "payouts", label: "Payouts", icon: WalletCards, group: "management" },
  { key: "guide", label: "Studio Guidelines", icon: BookOpen, group: "resources" },
  { key: "checklists", label: "Rental Checklist", icon: ClipboardCheck, group: "resources" },
  { key: "settings", label: "Settings", icon: Settings, group: "settings" },
];
const EMPLOYEE_NAV_ITEMS: NavigationItem[] = NAV_ITEMS.filter(item => !item.ownerOnly).map(item => ({
  ...item,
  label: item.key === "scheduling" ? "My Schedule" : item.key === "availability" ? "My Availability" : item.key === "payouts" ? "Earnings" : item.label,
  group: item.key === "payouts" ? "work" : item.group,
}));

function DashboardNavigation({ isOwner, accountId, view, onNavigate, unread }: { unread: number; isOwner: boolean; accountId: string; view: ViewKey; onNavigate: (view: ViewKey) => void }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const closeMobileMenu = () => { if (isMobile) setOpenMobile(false); };
  const items = isOwner ? NAV_ITEMS : EMPLOYEE_NAV_ITEMS;
  const groups: { key: NavigationGroup; label: string }[] = [
    { key: "home", label: "Start" },
    { key: "work", label: isOwner ? "Work" : "My work" },
    { key: "management", label: "Management" },
    { key: "resources", label: "Resources" },
  ];

  return <nav aria-label="Dashboard sections" className="studio-navigation">
    {groups.map(group => {
      const groupItems = items.filter(item => item.group === group.key);
      if (!groupItems.length) return null;
      return <SidebarGroup key={group.key} className="studio-nav-group" role="group" aria-label={group.label}>
        {group.key !== "home" && <SidebarGroupLabel asChild className="studio-nav-heading"><h2>{group.label}</h2></SidebarGroupLabel>}
        <SidebarGroupContent><SidebarMenu className="studio-nav">
          {groupItems.map(item => (
            <SidebarMenuItem key={item.key}>
              <SidebarMenuButton aria-current={view === item.key ? "page" : undefined} isActive={view === item.key}
                onClick={() => { onNavigate(item.key); closeMobileMenu(); }} tooltip={item.label}>
                <item.icon aria-hidden="true" /><span>{item.label}</span>{item.key === "alerts" && <UnreadBadge count={unread} />}
                {view === item.key && <ChevronRight className="sidebar-current-icon" aria-hidden="true" />}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
          {group.key === "resources" && <>
            <SidebarMenuItem className="studio-connected-start"><SidebarMenuButton asChild tooltip="Productions · opens in a new tab">
              <a href={`https://smooth-studios-production.smoothxstudios.workers.dev/?from=studio&account=${encodeURIComponent(accountId === "owner" ? "smooth" : accountId)}`} target="_blank" rel="noopener noreferrer" onClick={closeMobileMenu} aria-label="Productions (opens in a new tab)" title="Opens in a new tab">
                <Link2 aria-hidden="true" /><span>Productions</span><ExternalLink className="sidebar-external-icon" aria-hidden="true" />
              </a>
            </SidebarMenuButton></SidebarMenuItem>
            <SidebarMenuItem><SidebarMenuButton asChild tooltip="Content Vault · opens in a new tab">
              <a href="https://content.smoothstudios.co/" target="_blank" rel="noopener noreferrer" onClick={closeMobileMenu} aria-label="Content Vault (opens in a new tab)" title="Opens in a new tab">
                <FolderOpen aria-hidden="true" /><span>Content Vault</span><ExternalLink className="sidebar-external-icon" aria-hidden="true" />
              </a>
            </SidebarMenuButton></SidebarMenuItem>
          </>}
        </SidebarMenu></SidebarGroupContent>
      </SidebarGroup>;
    })}
  </nav>;
}

function MobileMenuButton() {
  const { openMobile, setOpenMobile } = useSidebar();
  return <Button className="mobile-menu-trigger" variant="ghost" size="icon" aria-label="Open navigation menu" aria-expanded={openMobile} onClick={() => setOpenMobile(!openMobile)}><Menu size={22} aria-hidden="true" /></Button>;
}

function SettingsNavigation({ active, onOpen }: { active: boolean; onOpen: () => void }) {
  const { isMobile, setOpenMobile } = useSidebar();
  return <nav aria-label="Account settings"><SidebarMenu className="studio-nav studio-settings-nav"><SidebarMenuItem>
    <SidebarMenuButton aria-current={active ? "page" : undefined} isActive={active} tooltip="Settings" onClick={() => { onOpen(); if (isMobile) setOpenMobile(false); }}>
      <Settings aria-hidden="true" /><span>Settings</span>{active && <ChevronRight className="sidebar-current-icon" aria-hidden="true" />}
    </SidebarMenuButton>
  </SidebarMenuItem></SidebarMenu></nav>;
}

function CloseMobileMenu() {
  const { isMobile, setOpenMobile } = useSidebar();
  return isMobile ? <Button className="mobile-sidebar-close" variant="ghost" size="icon" aria-label="Close navigation" onClick={() => setOpenMobile(false)}><X /></Button> : null;
}

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

function customerPaymentState(rental: Rental): CustomerPaymentState {
  if (customerFullyPaid(rental)) return "paid";
  if (rental.stripePayment?.disputed) return "review";
  if (new Date(rental.end).getTime() <= Date.now()) return "review";
  if ((rental.paidOnlineCents ?? 0) > 0) return "deposit";
  return "pending";
}

function paidEarnings(payout?: EmployeePayout) {
  return payout?.paidAmountCents ?? (payout?.paid ? payout.amountCents : 0);
}

function unpaidEarnings(payout?: EmployeePayout) {
  return payout?.outstandingCents ?? Math.max((payout?.amountCents ?? 0) - paidEarnings(payout), 0);
}

function EmployeeEarnings({ payout }: { payout?: EmployeePayout }) {
  return <div className="payment-amount"><strong className="share-amount">{payout?.compensationConfigured === false ? "Rate needed" : dollars(payout?.amountCents ?? 0, true)}</strong>
    {Boolean(payout?.advanceAppliedCents) && <span className="payment-detail">{dollars(payout!.advanceAppliedCents!, true)} covered by advance</span>}
    {payout?.compensationLabel && <span className="payment-detail">{payout.compensationLabel}</span>}
    {paidEarnings(payout) > 0 && unpaidEarnings(payout) > 0 && <span className="payment-detail payment-detail-review">{dollars(paidEarnings(payout), true)} paid · {dollars(unpaidEarnings(payout), true)} still owed</span>}
  </div>;
}

function rentalState(rental: Rental, employeeId?: string): RentalState {
  const ended = new Date(rental.end).getTime() <= Date.now();
  if (!ended) return "upcoming";
  if (!customerFullyPaid(rental)) return "awaiting";
  if (employeeId && rental.employeePayouts[employeeId]?.paid) return "paid";
  return "earned";
}

function eligibleForPayout(rental: Rental, paidThrough: string, employeeScope: string) {
  const endDate = new Intl.DateTimeFormat("en-CA", { timeZone: STUDIO_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(rental.end));
  if (endDate > paidThrough || new Date(rental.end).getTime() > Date.now() || !customerFullyPaid(rental)) return false;
  if (employeeScope === "all") return Object.values(rental.employeePayouts).some((payout) => unpaidEarnings(payout) > 0);
  const payout = rental.employeePayouts[employeeScope];
  return Boolean(payout && unpaidEarnings(payout) > 0);
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
  const [selection, setSelection] = useState<{ id: string; quickReady: boolean } | null>(null);
  const [usePassword, setUsePassword] = useState(false);
  const selectedId = selection?.id ?? profiles[0]?.id ?? "owner";
  const quickReady = selection?.quickReady ?? false;
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const profile = profiles.find(item => item.id === selectedId);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSelection(current => {
        const saved = current?.id ?? rememberedProfile();
        const id = saved && profiles.some(item => item.id === saved) ? saved : profiles[0]?.id ?? "owner";
        return { id, quickReady: Boolean(quickSignInRecord(id)) };
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [profiles]);
  const quickUnlock = async () => {
    if (!profile) return;
    setLoading(true); setError("");
    try {
      const savedPassword = await quickSignInPassword(profile.id);
      try { await onUnlock(profile, savedPassword); }
      catch { throw new Error("Quick sign-in couldn’t open the latest dashboard. Try your password; if it changed, set up quick sign-in again."); }
    } catch (error) { setError(quickSignInError(error)); }
    finally { setLoading(false); }
  };

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
          <p className="eyebrow">Dashboard</p>
          <h1>Sign in</h1>
        </div>
        {!selection ? <p className="login-preparing" role="status">Preparing sign-in…</p> : quickReady && !usePassword ? <><div className="quick-login"><Button disabled={loading} onClick={quickUnlock}><Fingerprint size={20} />{loading ? "Opening…" : `Continue as ${profile?.label ?? selectedId}`}</Button></div>
          {error && <div className="quick-sign-in-recovery"><p className="login-error" role="alert">{error}</p><Button variant="outline" disabled={loading} onClick={() => { setUsePassword(true); setPassword(""); setShowPassword(false); setError(""); }}>Use password</Button></div>}
          <button className="login-account-switch" disabled={loading} onClick={() => { setUsePassword(true); setPassword(""); setShowPassword(false); setError(""); }}>Sign in to another account</button>
        </> : <form onSubmit={submit}>
          <input type="hidden" name="username" autoComplete="username" value={selectedId === "owner" ? "smooth" : selectedId} />
          <label className="select-label" htmlFor="dashboard-profile">Account</label>
          <div className="select-field">
            <Users aria-hidden="true" size={17} />
            <select
              id="dashboard-profile"
              disabled={loading}
              onChange={(event) => { const id = event.target.value; setSelection({ id, quickReady: Boolean(quickSignInRecord(id)) }); setPassword(""); setShowPassword(false); setError(""); }}
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
                name="password"
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
          {quickReady && <button type="button" className="login-account-switch" disabled={loading} onClick={() => { setUsePassword(false); setPassword(""); setError(""); }}>Use quick sign-in</button>}
        </form>}
        <DashboardVersionFooter compact />
      </div>
    </main>
  );
}

function OwnerFinancialSummary({ rentals, creative, upcomingCount, totalOwed, onSchedule, onPayouts }: {
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
    <p className="owner-finance-basis">Completed, fully paid appointments, including tips. Team pay includes approved creative work. Before fees and other expenses.</p>
    <div className="owner-finance-shortcuts"><button onClick={onSchedule}><CalendarDays size={16} />{upcomingCount} upcoming appointments<ChevronRight size={15} /></button><button onClick={onPayouts}><WalletCards size={16} />Total still owed: {ready ? dollars(totalOwed, true) : "—"}<ChevronRight size={15} /></button></div>
  </section>;
}

function PeriodTotals({ rentals, employeeId, creative = [] }: { rentals: Rental[]; employeeId?: string; creative?: CreativeAssignment[] }) {
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

function StripeMoneyFlow({
  summary,
  unmatchedPayments,
  onMatch,
}: {
  summary?: StripeSummary;
  unmatchedPayments: UnmatchedStripePayment[];
  onMatch: (paymentId?: string) => void;
}) {
  if (!summary) {
    return (
      <section className="panel stripe-flow-panel stripe-flow-disconnected">
        <div className="stripe-flow-intro">
          <span className="stripe-flow-icon"><CreditCard size={21} /></span>
          <div><p className="eyebrow">Money flow</p><h2>Stripe is not connected yet</h2><p>Calendar payment fields remain active until the read-only Stripe sync is enabled.</p></div>
        </div>
      </section>
    );
  }

  const flowItems = [
    { label: "Gross received", value: summary.grossCents, note: `${summary.paymentCount} successful payment${summary.paymentCount === 1 ? "" : "s"}` },
    { label: "Refunded", value: summary.refundedCents, note: "Returned to customers" },
    { label: "Stripe fees", value: summary.feeCents, note: "Processing costs" },
    { label: "Net after fees", value: summary.netCents, note: "Gross minus refunds and fees" },
    { label: "Paid to bank", value: summary.bankPayoutCents, note: summary.pendingPayoutCents ? `${dollars(summary.pendingPayoutCents, true)} still moving` : "Completed Stripe payouts" },
  ];

  return (
    <section className="panel stripe-flow-panel">
      <div className="panel-heading stripe-flow-heading">
        <div><p className="eyebrow">Money flow</p><h2>Stripe reconciliation</h2></div>
        <span className="stripe-connected"><span /> Updated {formatDate(summary.generatedAt, true)} at {formatTime(summary.generatedAt)}</span>
      </div>
      <div className="stripe-flow-grid">
        {flowItems.map((item, index) => (
          <article key={item.label}>
            <span className="stripe-flow-item-icon">{index === 4 ? <Landmark size={16} /> : <CreditCard size={16} />}</span>
            <div><span>{item.label}</span><strong>{dollars(item.value, true)}</strong><small>{item.note}</small></div>
          </article>
        ))}
      </div>
      {summary.unmatchedPaymentCount > 0 && (
        <div className="stripe-unmatched">
          <div className="stripe-unmatched-heading">
            <span><TriangleAlert size={17} /></span>
            <div>
              <strong>{summary.unmatchedPaymentCount} Stripe payment{summary.unmatchedPaymentCount === 1 ? "" : "s"} need matching</strong>
              <small>{dollars(summary.unmatchedCents, true)} was received but could not be safely tied to a Calendar appointment.</small>
              <Button onClick={() => onMatch()} size="sm" variant="outline"><Link2 size={14} /> Match payments</Button>
            </div>
          </div>
          <div className="stripe-unmatched-list">
            {unmatchedPayments.slice(0, 5).map((payment) => (
              <button aria-label={`Match ${payment.customerName || payment.customerEmail || "unknown customer"} payment of ${dollars(payment.amountCents, true)}`} disabled={!payment.matchKey} key={`${payment.matchKey || payment.reference}-${payment.created}`} onClick={() => onMatch(payment.matchKey)} type="button">
                <span><strong>{payment.customerName || payment.customerEmail || "Unknown customer"}</strong><small>{formatDate(payment.created, true)} · ref {payment.reference}</small></span>
                <b>{dollars(payment.amountCents, true)}</b>
                <em>Match</em>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function OwnerAttention({ reviewCount, unmatchedCount, stripeConnected, onReview, onMatch, onPayouts }: {
  reviewCount: number; unmatchedCount: number; stripeConnected: boolean;
  onReview: () => void; onMatch: () => void; onPayouts: () => void;
}) {
  return (
    <article className="panel owner-attention">
      <div className="panel-heading"><h2>Needs attention</h2></div>
      <div className="owner-attention-list">
        {reviewCount > 0 && <button className="owner-attention-item" onClick={onReview}>
          <span className="owner-action-icon"><ReceiptText size={19} /></span>
          <span><strong>Review appointment payments</strong><small>{reviewCount} appointment{reviewCount === 1 ? "" : "s"} with an unconfirmed balance</small></span>
          <ChevronRight size={17} />
        </button>}
        {unmatchedCount > 0 && <button className="owner-attention-item" onClick={onMatch}>
          <span className="owner-action-icon"><Link2 size={19} /></span>
          <span><strong>Match Stripe payments</strong><small>{unmatchedCount} received payment{unmatchedCount === 1 ? "" : "s"} to link</small></span>
          <ChevronRight size={17} />
        </button>}
        {!reviewCount && !unmatchedCount && <div className="owner-attention-empty">
          <span><Check size={21} /></span><strong>No payment reviews waiting</strong>
          <p>{stripeConnected ? "Appointment balances and Stripe matches are up to date." : "No appointment balances need review."}</p>
        </div>}
      </div>
      <button className="owner-panel-link" onClick={onPayouts}>Manage team payouts <ArrowRight size={16} /></button>
    </article>
  );
}

function OwnerUpcoming({ rentals, onSchedule }: { rentals: Rental[]; onSchedule: () => void }) {
  return (
    <article className="panel owner-upcoming">
      <div className="panel-heading"><div><h2>Coming up</h2><p>Next on your calendar</p></div><button onClick={onSchedule}>Open schedule <ChevronRight size={15} /></button></div>
      {rentals.length ? <ol className="owner-upcoming-list">
        {rentals.slice(0, 4).map(rental => <li key={rental.id}>
          <time className="owner-date-block" dateTime={rental.start} aria-label={formatDate(rental.start)}>
            <span>{new Intl.DateTimeFormat("en-US", { timeZone: STUDIO_TIME_ZONE, month: "short" }).format(new Date(rental.start))}</span>
            <strong>{new Intl.DateTimeFormat("en-US", { timeZone: STUDIO_TIME_ZONE, day: "numeric" }).format(new Date(rental.start))}</strong>
          </time>
          <div className="owner-appointment-copy"><strong>{rental.customer}</strong><span>{rental.title}</span></div>
          <div className="owner-appointment-time"><strong>{formatTime(rental.start)}</strong><span>{durationLabel(rental)}</span></div>
        </li>)}
      </ol> : <EmptyState title="Nothing coming up yet" copy="New Calendar appointments will appear here after syncing." />}
    </article>
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
  const source = rental.paymentSource === "stripe" ? "Stripe" : rental.paymentSource === "manual" ? "manual review" : "Calendar";

  if (rental.paymentOverride === false) {
    detail = `${paidOnline > 0 ? `${dollars(paidOnline, true)} recorded · ` : ""}marked not fully paid`;
    tone = "review";
  } else if (rental.stripePayment?.disputed) {
    detail = `${dollars(paidOnline, true)} received · dispute needs review`;
    tone = "review";
  } else if (rental.paymentOverride === true && remaining > 0) {
    detail = paidOnline > 0 ? `${dollars(paidOnline, true)} online · payment confirmed` : "Payment confirmed manually";
    tone = "paid";
  } else if (tip > 0) {
    detail = `${dollars(paidOnline, true)} via ${source} · ${dollars(tip, true)} tip`;
    tone = "tip";
  } else if (remaining > 0 && paidOnline > 0) {
    detail = `${dollars(paidOnline, true)} via ${source} · ${dollars(remaining, true)} remaining`;
    tone = "deposit";
  } else if (paidOnline >= rental.priceCents) {
    detail = `${dollars(paidOnline, true)} received via ${source}`;
    tone = "paid";
  }

  return <div className="payment-amount"><strong>{dollars(rental.priceCents, true)}</strong>{showDetails && <span className={`payment-detail payment-detail-${tone}`}>{detail}</span>}</div>;
}

function RentalTable({ rentals, employeeId }: { rentals: Rental[]; employeeId?: string }) {
  return (
    <Table className="rental-table" role="table" aria-label="Appointments">
      <TableHeader role="rowgroup"><TableRow role="row"><TableHead role="columnheader">Appointment</TableHead><TableHead role="columnheader">Category</TableHead><TableHead role="columnheader">Date & time</TableHead><TableHead role="columnheader">{employeeId ? "Price" : "Price / recorded payment"}</TableHead><TableHead role="columnheader">{employeeId ? "Your earnings" : "Assigned team"}</TableHead><TableHead role="columnheader">Status</TableHead></TableRow></TableHeader>
      <TableBody role="rowgroup">
        {rentals.map((rental) => (
          <TableRow key={rental.id} role="row">
            <TableCell className="rental-name-cell" role="cell"><div className="rental-name"><strong>{rental.customer}</strong><span>{rental.title}</span></div></TableCell>
            <TableCell className="rental-category-cell" role="cell"><CategoryBadge rental={rental} /></TableCell>
            <TableCell className="rental-date-cell" data-label="Date & time" role="cell"><div className="rental-date"><strong>{formatDate(rental.start, true)}</strong><span>{formatTime(rental.start)} · {durationLabel(rental)}</span></div></TableCell>
            <TableCell className="money-cell" data-label={employeeId ? "Price" : "Price / payment"} role="cell"><PaymentAmount rental={rental} showDetails={!employeeId} /></TableCell>
            <TableCell data-label={employeeId ? "Your earnings" : "Assigned team"} role="cell">
              {employeeId ? <EmployeeEarnings payout={rental.employeePayouts[employeeId]} /> : <div className="avatar-stack">{rental.assignedEmployeeIds.length ? rental.assignedEmployeeIds.map((id) => <span aria-label={FALLBACK_PROFILES.find(profile => profile.id === id)?.label ?? id} key={id} style={{ background: teamAccent(id) }}>{id.slice(0, 1).toUpperCase()}</span>) : <em>Unassigned</em>}</div>}
            </TableCell>
            <TableCell className="rental-status-cell" data-label="Status" role="cell"><StatusBadge state={appointmentStatus(rental, employeeId)} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function EmptyState({ title, copy }: { title: string; copy: string }) {
  return <div className="empty-state"><CalendarDays size={28} /><strong>{title}</strong><p>{copy}</p></div>;
}

function TeamPage({ employees, rentals, creative, payroll, teamAccess, onSetup }: { employees: Employee[]; rentals: Rental[]; creative: CreativeAssignment[]; payroll?: PayrollState; teamAccess?: DashboardPayload["teamAccess"]; onSetup: () => void }) {
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
    const resetTimer = window.setTimeout(() => {
      setEventId(reviewRentals[0]?.id ?? "");
      setPaidStatus("true");
    }, 0);
    return () => window.clearTimeout(resetTimer);
  }, [open, reviewRentals]);

  const selected = reviewRentals.find((rental) => rental.id === eventId);
  const statusLabels = { true: "Payment received by invoice, cash, or other", false: "Not fully paid", clear: "Use automatic payment records" };
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
          : "This removes the manual decision and returns the appointment to its automatic Stripe or Calendar payment status.",
      actionLabel: paidStatus === "true" ? "Confirm payment received" : paidStatus === "false" ? "Mark not fully paid" : "Clear manual status",
      inputs: { event_id: selected.id, paid_status: paidStatus },
      details: [
        { label: "Appointment", value: `${selected.customer} · ${selected.title}` },
        { label: "Date", value: `${formatDate(selected.start, true)} at ${formatTime(selected.start)}` },
        { label: "Price", value: dollars(selected.priceCents, true) },
        { label: selected.paymentSource === "stripe" ? "Stripe received" : "Calendar “Paid Online”", value: recorded },
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
                <div><span>{selected.paymentSource === "stripe" ? "Stripe received" : "Calendar “Paid Online”"}</span><strong>{selected.paidOnlineCents === null ? "None" : dollars(selected.paidOnlineCents, true)}</strong></div>
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

function normalizedMatchText(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stripeAppointmentScore(payment: UnmatchedStripePayment, rental: Rental) {
  const paymentName = normalizedMatchText(payment.customerName);
  const customer = normalizedMatchText(rental.customer);
  let score = 0;
  if (paymentName && customer && paymentName === customer) score += 100;
  else if (paymentName && customer && (paymentName.includes(customer) || customer.includes(paymentName))) score += 45;
  if (payment.amountCents === rental.priceCents) score += 50;
  else if (payment.amountCents < rental.priceCents) score += 22;
  const distance = Math.abs(new Date(rental.start).getTime() - new Date(payment.created).getTime()) / 86_400_000;
  if (distance <= 7) score += 35;
  else if (distance <= 45) score += 20;
  else if (distance <= 180) score += 8;
  return score;
}

function StripeMatchForm({
  open,
  onOpenChange,
  onContinue,
  payments,
  rentals,
  initialPaymentId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContinue: (request: OwnerWorkflowRequest) => void;
  payments: UnmatchedStripePayment[];
  rentals: Rental[];
  initialPaymentId: string;
}) {
  const [paymentId, setPaymentId] = useState("");
  const [eventId, setEventId] = useState("");
  const [query, setQuery] = useState("");
  const matchablePayments = useMemo(() => payments.filter((payment) => Boolean(payment.matchKey)), [payments]);

  useEffect(() => {
    if (!open) return;
    const resetTimer = window.setTimeout(() => {
      setPaymentId(initialPaymentId || matchablePayments[0]?.matchKey || "");
      setEventId("");
      setQuery("");
    }, 0);
    return () => window.clearTimeout(resetTimer);
  }, [initialPaymentId, matchablePayments, open]);

  const selectedPayment = matchablePayments.find((payment) => payment.matchKey === paymentId);
  const sortedRentals = useMemo(() => {
    if (!selectedPayment) return [];
    return [...rentals].sort((a, b) => {
      const scoreDifference = stripeAppointmentScore(selectedPayment, b) - stripeAppointmentScore(selectedPayment, a);
      return scoreDifference || new Date(b.start).getTime() - new Date(a.start).getTime();
    });
  }, [rentals, selectedPayment]);
  const matchingRentals = useMemo(() => {
    const words = normalizedMatchText(query).split(" ").filter(Boolean);
    const filtered = words.length
      ? sortedRentals.filter((rental) => {
        const searchable = normalizedMatchText(`${rental.customer} ${rental.title} ${rental.category ?? ""} ${formatDate(rental.start)} ${dollars(rental.priceCents, true)}`);
        return words.every((word) => searchable.includes(word));
      })
      : sortedRentals;
    return filtered.slice(0, 16);
  }, [query, sortedRentals]);
  const selectedRental = rentals.find((rental) => rental.id === eventId);

  const changePayment = (nextPaymentId: string) => {
    setPaymentId(nextPaymentId);
    setEventId("");
    setQuery("");
  };

  const continueToConfirmation = () => {
    if (!selectedPayment || !selectedRental?.stripeMatchKey) return;
    onOpenChange(false);
    onContinue({
      workflowId: "match-stripe-payment.yml",
      title: "Match Stripe payment",
      description: "This links this Stripe charge to the selected Calendar appointment. Deposits, final payments, and tips can each be linked to the same appointment.",
      actionLabel: "Save payment match",
      inputs: { charge_key: selectedPayment.matchKey, event_key: selectedRental.stripeMatchKey ?? "" },
      details: [
        { label: "Stripe payment", value: `${selectedPayment.customerName || selectedPayment.customerEmail || "Unknown customer"} · ${dollars(selectedPayment.amountCents, true)}` },
        { label: "Payment date", value: `${formatDate(selectedPayment.created, true)} · ref ${selectedPayment.reference}` },
        { label: "Calendar appointment", value: `${selectedRental.customer} · ${selectedRental.title}` },
        { label: "Appointment date", value: `${formatDate(selectedRental.start, true)} at ${formatTime(selectedRental.start)}` },
        { label: "Appointment price", value: dollars(selectedRental.priceCents, true) },
      ],
    });
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="stripe-match-dialog">
        <DialogHeader>
          <p className="eyebrow">Stripe reconciliation</p>
          <DialogTitle>Match payment to appointment</DialogTitle>
          <DialogDescription>Select the Stripe payment, then choose the Calendar appointment it belongs to. Leave unrelated payments unmatched—they still count in Stripe totals.</DialogDescription>
        </DialogHeader>
        {matchablePayments.length ? (
          <>
            <div className="workflow-form-field">
              <label htmlFor="stripe-payment">Stripe payment</label>
              <select id="stripe-payment" onChange={(event) => changePayment(event.target.value)} value={paymentId}>
                {matchablePayments.map((payment) => (
                  <option key={payment.matchKey} value={payment.matchKey}>
                    {formatDate(payment.created, true)} · {payment.customerName || payment.customerEmail || "Unknown customer"} · {dollars(payment.amountCents, true)}
                  </option>
                ))}
              </select>
            </div>
            {selectedPayment && (
              <div className="stripe-payment-summary">
                <div><span>Customer</span><strong>{selectedPayment.customerName || selectedPayment.customerEmail || "Unknown"}</strong></div>
                <div><span>Received</span><strong>{dollars(selectedPayment.amountCents, true)}</strong></div>
                <div><span>Reference</span><strong>{selectedPayment.reference}</strong></div>
              </div>
            )}
            <div className="stripe-appointment-picker">
              <label htmlFor="appointment-search">Calendar appointment</label>
              <div className="stripe-search-field"><Search size={17} /><Input autoComplete="off" id="appointment-search" onChange={(event) => setQuery(event.target.value)} placeholder="Search customer, package, date, or price" type="search" value={query} /></div>
              <div aria-label="Calendar appointment choices" className="stripe-appointment-list" role="listbox">
                {matchingRentals.length ? matchingRentals.map((rental, index) => {
                  const selected = rental.id === eventId;
                  const likely = !query && index < 3 && selectedPayment && stripeAppointmentScore(selectedPayment, rental) >= 80;
                  return (
                    <button aria-selected={selected} className={selected ? "selected" : ""} key={rental.id} onClick={() => setEventId(rental.id)} role="option" type="button">
                      <span className="stripe-appointment-date"><strong>{formatDate(rental.start, true)}</strong><small>{formatTime(rental.start)}</small></span>
                      <span className="stripe-appointment-copy"><strong>{rental.customer}</strong><small>{rental.title}</small></span>
                      {likely && <Badge variant="secondary">Possible match</Badge>}
                      <span className="stripe-appointment-amount"><strong>{dollars(rental.priceCents, true)}</strong><small>{rental.paidOnlineCents === null ? "No payment linked" : `${dollars(rental.paidOnlineCents, true)} recorded`}</small></span>
                      <span className="stripe-appointment-check">{selected && <Check size={16} />}</span>
                    </button>
                  );
                }) : <EmptyState copy="Try the customer's last name, package name, month, or price." title="No appointments found" />}
              </div>
              {!query && sortedRentals.length > matchingRentals.length && <small className="stripe-picker-note">Showing the closest possibilities first. Search to find any other 2026 appointment.</small>}
            </div>
          </>
        ) : <EmptyState copy={payments.length ? "Run Sync now once to prepare these payments for manual matching." : "The next Stripe sync will add any payments that still need matching."} title={payments.length ? "One more sync needed" : "No unmatched payments"} />}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">Cancel</Button>
          <Button className="workflow-run-button" disabled={!selectedPayment || !selectedRental?.stripeMatchKey} onClick={continueToConfirmation}>Continue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DashboardView({ payload, dark, setDark, onLogout, onRefresh, sessionPassword, schedulingToken }: { payload: DashboardPayload; dark: boolean; setDark: (value: boolean) => void; onLogout: () => void; onRefresh: () => Promise<boolean>; sessionPassword: string; schedulingToken: string }) {
  useRefreshSource(onRefresh);
  const [view, setView] = useState<ViewKey>("overview");
  const [focusedAlert, setFocusedAlert] = useState<{ target: string; id: string } | null>(null);
  const [alertWorkLoading, setAlertWorkLoading] = useState(false);
  const navigate = (next: ViewKey) => { setFocusedAlert(null); setView(next); };
  const openChecklist = () => navigate("checklists");
  const alerts = useAlerts(schedulingToken, view === "alerts");
  const payroll = usePayroll(schedulingToken, payload.payroll);
  const creative = useCreativeWork(schedulingToken);
  const openAlert = async (alert: DashboardAlert) => {
    setFocusedAlert(alert.targetId ? { target: alert.target, id: alert.targetId } : null);
    if (alert.target === "quiz") {
      setView("overview");
      if (window.location.hash === "#daily-quiz") window.dispatchEvent(new Event("hashchange"));
      else window.location.hash = "#daily-quiz";
    } else if (alert.target === "creative") {
      setView("creative"); setAlertWorkLoading(true);
      try { await creative.refresh(); } finally { setAlertWorkLoading(false); }
    } else setView(alert.target === "availability" ? "availability" : "scheduling");
  };
  const creativeTotals = useMemo(() => creativeEarnings(creative.items), [creative.items]);
  const currentYear = Number(studioLocal(Date.now()).slice(0, 4));
  const [earningsYear, setEarningsYear] = useState(currentYear);
  const [teamSetupOpen, setTeamSetupOpen] = useState(false);
  const [teamSetupBusy, setTeamSetupBusy] = useState(false);
  useEffect(() => {
    if (payload.role === "owner" && window.location.hash.startsWith("#setup-team")) { setView("team"); setTeamSetupOpen(true); }
  }, [payload.role]);
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "instant" }); }, [view]);
  useEffect(() => {
    const openSchedule = () => {
      if (window.location.hash === "#alerts") setView("alerts");
      if (window.location.hash === "#creative-work") setView("creative");
      if (window.location.hash === "#scheduling") setView("scheduling");
      if (window.location.hash === "#daily-quiz") setView("overview");
      if (["#guidelines", "#guidelines-questions"].includes(window.location.hash)) setView("guide");
    };
    openSchedule();
    window.addEventListener("hashchange", openSchedule);
    return () => window.removeEventListener("hashchange", openSchedule);
  }, []);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all");
  const [paidThrough, setPaidThrough] = useState(new Date().toISOString().slice(0, 10));
  const [payoutEmployee, setPayoutEmployee] = useState("all");
  const [paymentOverrideOpen, setPaymentOverrideOpen] = useState(false);
  const [stripeMatchOpen, setStripeMatchOpen] = useState(false);
  const [stripeMatchPaymentId, setStripeMatchPaymentId] = useState("");
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [workflowRequest, setWorkflowRequest] = useState<OwnerWorkflowRequest | null>(null);
  const isOwner = payload.role === "owner";
  const employeeId = isOwner ? undefined : payload.user.id;
  const rentals = useMemo(() => applyRentalAdvances(payload.rentals, payroll.state).sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime()), [payload.rentals, payroll.state]);
  const advance = payroll.state?.balances.find(item => item.employeeId === employeeId);
  const visibleRentals = useMemo(() => employeeId ? rentals.filter((rental) => rental.assignedEmployeeIds.includes(employeeId)) : rentals, [employeeId, rentals]);
  const pastRentals = visibleRentals.filter(rental => Date.parse(rental.end) <= Date.now());
  const employeeEarnings = useMemo(() => {
    const rental = employeeEarningsForYear(visibleRentals, employeeId, earningsYear);
    const work = creativeEarnings(creative.items, earningsYear);
    return { ...rental, metrics: { ...rental.metrics, paid: rental.metrics.paid + work.metrics.paid, owed: rental.metrics.owed + work.metrics.owed, projected: rental.metrics.projected + work.metrics.projected },
      monthly: rental.monthly.map((month, index) => ({ ...month, paid: month.paid + work.monthly[index].paid, owed: month.owed + work.monthly[index].owed })) };
  }, [visibleRentals, employeeId, earningsYear, creative.items]);
  const earningsYears = [...new Set([currentYear, ...visibleRentals.map(rental => Number(studioLocal(rental.start).slice(0, 4))), ...creative.items.map(item => Number(studioLocal(creativeEarningDate(item)).slice(0, 4)))])].sort((a, b) => b - a);
  const categoryOptions = useMemo(() => APPOINTMENT_CATEGORIES.filter((category) => visibleRentals.some((rental) => appointmentCategory(rental).id === category.id)), [visibleRentals]);
  const filteredRentals = useMemo(() => visibleRentals.filter((rental) =>
    (categoryFilter === "all" || appointmentCategory(rental).id === categoryFilter)
    && (paymentFilter === "all" || customerPaymentState(rental) === paymentFilter),
  ), [categoryFilter, paymentFilter, visibleRentals]);
  const reviewRentals = useMemo(() => rentals.filter((rental) => customerPaymentState(rental) === "review"), [rentals]);
  const upcoming = useMemo(() => [...visibleRentals].filter((rental) => rentalState(rental, employeeId) === "upcoming").reverse(), [employeeId, visibleRentals]);
  const stripeConnected = Boolean(payload.integrations?.stripe && payload.stripeSummary);

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
        paid += paidEarnings(payout);
        if (state === "earned") owed += unpaidEarnings(payout);
        else if (state === "upcoming") projected += payout.amountCents;
      }
    }
    return { revenue, owed: owed + creativeTotals.metrics.owed, paid: paid + creativeTotals.metrics.paid, projected: projected + creativeTotals.metrics.projected };
  }, [employeeId, visibleRentals, creativeTotals]);

  const monthly = useMemo(() => {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((month) => ({ month, revenue: 0, payroll: 0, paid: 0, owed: 0 }));
    for (const rental of visibleRentals) {
      const month = new Date(rental.start).getUTCMonth();
      months[month].revenue += recognizedRevenue(rental);
      const payouts = employeeId ? [rental.employeePayouts[employeeId]].filter(Boolean) : Object.values(rental.employeePayouts);
      for (const payout of payouts) {
        months[month].payroll += payout.amountCents;
        months[month].paid += paidEarnings(payout);
        if (rentalState(rental, employeeId) === "earned") months[month].owed += unpaidEarnings(payout);
      }
    }
    return months.map((month, index) => ({ ...month, paid: month.paid + creativeTotals.monthly[index].paid, owed: month.owed + creativeTotals.monthly[index].owed, payroll: month.payroll + creativeTotals.monthly[index].paid + creativeTotals.monthly[index].owed }));
  }, [employeeId, visibleRentals, creativeTotals]);

  const displayName = payload.user.name;

  const prepareTeamSetup = async (settings: NewTeamSettings) => {
    setTeamSetupBusy(true);
    try {
      const envelope = await encryptWorkflowPayload(settings, sessionPassword);
      setTeamSetupOpen(false);
      openWorkflow({ workflowId: "update-team.yml", title: "Activate employee accounts", actionLabel: "Activate accounts",
        description: "Create private logins, enable scheduling access, and refresh the team dashboards.",
        inputs: { team_envelope: JSON.stringify(envelope) },
        details: Object.entries(settings.employees).map(([id, entry]) => ({ label: TEAM.find(p => p.id === id)?.name ?? id,
          value: `${entry.email} · ${entry.compensation.type === "hourly" ? dollars(entry.compensation.hourlyCents!, true) + "/hour" : entry.compensation.type === "commission" ? (entry.compensation.rate! * 100) + "%" : "Pay rate to be set"}` })) });
    } finally { setTeamSetupBusy(false); }
  };

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
    title: "Sync Calendar and Stripe",
    description: "This imports the latest appointments and payment activity, reconciles their records, rebuilds every encrypted dashboard, and republishes the portal.",
    actionLabel: "Start data sync",
    details: [
      { label: "Calendar", value: payload.calendarName },
      { label: "Payments", value: stripeConnected ? "Stripe connected" : "Calendar fields only" },
      { label: "Import range", value: "January 1, 2026 through today" },
      { label: "Current data generated", value: `${formatDate(payload.generatedAt, true)} at ${formatTime(payload.generatedAt)}` },
    ],
  });

  const publishStudioGuide = async (entries: StudioGuideline[]) => {
    if (!isOwner || !sessionPassword) throw new Error("Unlock the Smooth dashboard again before publishing Studio Guidelines.");
    const submittedGuide = createGuidePatch(payload.rulebook, entries);
    if (!submittedGuide.upserts.length && !submittedGuide.deleteIds.length) throw new Error("There are no new changes to publish.");
    if (new TextEncoder().encode(JSON.stringify(submittedGuide)).length > MAX_GUIDELINE_UPDATE_BYTES) {
      throw new Error("These changes exceed the 40 KB update limit. Shorten the new instructions or publish a smaller group of changes.");
    }
    const encryptedGuide = await encryptWorkflowPayload(submittedGuide, sessionPassword);
    openWorkflow({
      workflowId: "update-guidelines.yml",
      title: "Publish Studio Guidelines",
      description: "This shares your saved guidelines with every team member and republishes the portal.",
      actionLabel: "Publish guidelines",
      inputs: { guide_envelope: JSON.stringify(encryptedGuide) },
      details: [
        { label: "Guidelines", value: String(entries.length) },
        { label: "Categories", value: String(new Set(entries.map((entry) => entry.category)).size) },
        { label: "Visibility", value: "Every logged-in team dashboard" },
      ],
    });
  };

  const openPaymentOverride = () => {
    if (reviewRentals.length) setPaymentOverrideOpen(true);
  };
  const openStripeMatch = (paymentId = "") => {
    setStripeMatchPaymentId(paymentId);
    setStripeMatchOpen(true);
  };
  const reviewPayments = () => {
    setCategoryFilter("all");
    setPaymentFilter("review");
    setView("rentals");
  };

  return (
    <SidebarProvider>
      <EmployeeEngagementProvider key={payload.user.id} token={schedulingToken} enabled={!isOwner} homeActive={view === "overview"}>
      {isOwner && <TeamAccountSetup open={teamSetupOpen} onOpenChange={setTeamSetupOpen} employees={payload.employees} busy={teamSetupBusy} onSubmit={prepareTeamSetup} enabled={Boolean(payload.workflowAccess)} />}
      <Sidebar className="dashboard-sidebar" collapsible="offcanvas">
        <SidebarHeader className="sidebar-brand"><CloseMobileMenu /><Logo compact /></SidebarHeader>
        <SidebarContent className="studio-sidebar-content">
          <DashboardNavigation isOwner={isOwner} accountId={payload.user.id} view={view} onNavigate={navigate} unread={alerts.unreadCount} />
          {!isOwner && <div className="sidebar-progress"><SmoothStarSidebar /></div>}
        </SidebarContent>
        <SidebarFooter className="studio-sidebar-footer">
          <SettingsNavigation active={view === "settings"} onOpen={() => navigate("settings")} />
          <div className="sidebar-user"><span className="user-avatar" style={{ background: teamAccent(payload.user.id, payload.user.accent) }}>{displayName.slice(0, 1)}</span><div><strong>{displayName}</strong><span>{isOwner ? "Studio dashboard" : "Team member"}</span></div><button aria-label="Log out" title="Log out" onClick={onLogout}><LogOut size={18} /></button></div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className={`dashboard-main${isOwner ? " owner-dashboard" : ""}`}>
        <header className="dashboard-topbar">
          <div className="topbar-heading"><MobileMenuButton /><div className="topbar-title"><div><p>{isOwner ? "Smooth dashboard" : "My dashboard"}</p><h1>{view === "overview" ? `Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, ${displayName}` : (isOwner ? NAV_ITEMS : EMPLOYEE_NAV_ITEMS).find((item) => item.key === view)?.label}</h1></div></div></div>
          <div className="topbar-actions">{payload.source === "sample" && <Badge className="sample-badge" variant="outline">Preview data</Badge>}<Button className="topbar-alerts" variant="outline" size="icon" title="Alerts" aria-label={`Alerts${alerts.unreadCount ? `, ${alerts.unreadCount} unread` : ""}`} onClick={() => navigate("alerts")}><Bell size={20} /><UnreadBadge count={alerts.unreadCount} /></Button></div>
        </header>
        <PullToRefresh key={view} page={view} />
        <div className="dashboard-refresh-body">
        <div className={`dashboard-content${!isOwner && view === "payouts" ? " employee-earnings-view" : ""}`}>
          {view === "alerts" && <AlertsPage state={alerts} onOpen={alert => void openAlert(alert)} />}
          {!isOwner && view === "overview" && <EmployeeEngagementBar />}
          {["overview", "team", "payouts"].includes(view) && creative.error && <p className="creative-notice" role="alert">Creative work totals could not be refreshed. <button onClick={() => void creative.refresh()}>Try again</button></p>}
          {view === "overview" && !isOwner && <CreativeWorkPreview state={creative} isOwner={false} onOpen={() => setView("creative")} />}
          {view === "payouts" && payroll.error && <p className="schedule-warning" role="status">{payroll.error}</p>}
          {view === "payouts" && isOwner && Boolean(payroll.state?.reviewCount) && <p className="schedule-warning" role="status">A previously credited earning changed in Calendar. Its advance credit is preserved and needs review.</p>}
          {view === "settings" && <DashboardSettings token={schedulingToken} profile={{ id: payload.user.id, label: displayName, role: payload.role }} password={sessionPassword} dark={dark} onThemeChange={setDark} onSync={isOwner ? openCalendarSync : undefined} lastSynced={`${formatDate(payload.generatedAt, true)} · ${formatTime(payload.generatedAt)}`} />}
          {view === "checklists" && <StudioInfoPage token={schedulingToken} isOwner={isOwner} userId={payload.user.id} section="checklists" />}
          {view === "creative" && <CreativeWorkPage state={creative} employees={payload.employees} isOwner={isOwner} focusLoading={alertWorkLoading} focusId={focusedAlert?.target === "creative" ? focusedAlert.id : undefined} onCloseFocus={() => setFocusedAlert(null)} />}
          {view === "overview" && !isOwner && <TeamSchedulingPage onChecklist={openChecklist} token={schedulingToken} userId={payload.user.id} isOwner={false} home={{ rentals: visibleRentals, owed: metrics.owed, advance, onAvailability: () => setView("availability"), onSchedule: () => setView("scheduling"), onEarnings: () => setView("payouts"), onGuide: () => setView("guide"), onChecklist: openChecklist }} />}
          {view === "overview" && isOwner && (
            <div className="owner-overview">
              <OwnerFinancialSummary rentals={visibleRentals} creative={creative} upcomingCount={upcoming.length} totalOwed={metrics.owed} onSchedule={() => setView("scheduling")} onPayouts={() => setView("payouts")} />
              <section className="owner-workspace" aria-label="Upcoming work and payment reviews">
                <OwnerUpcoming rentals={upcoming} onSchedule={() => setView("scheduling")} />
                <OwnerAttention reviewCount={reviewRentals.length} unmatchedCount={payload.stripeSummary?.unmatchedPaymentCount ?? payload.unmatchedStripePayments?.length ?? 0} stripeConnected={stripeConnected} onReview={reviewPayments} onMatch={() => openStripeMatch()} onPayouts={() => setView("payouts")} />
              </section>
              <CreativeWorkPreview state={creative} isOwner onOpen={() => setView("creative")} />
              <details className="owner-reports">
                <summary>
                  <span className="owner-reports-icon"><BarChart3 size={21} /></span>
                  <span className="owner-reports-copy"><strong>Financial reports</strong><small>Revenue, Stripe, and category breakdowns</small></span>
                  <span className="owner-reports-toggle"><span className="reports-show">Show reports</span><span className="reports-hide">Hide reports</span><ChevronDown size={18} /></span>
                </summary>
                <div className="owner-reports-content">
                  <PeriodTotals creative={creative.items} rentals={visibleRentals} />
                  <article className="panel trend-panel">
                    <div className="panel-heading"><h2>Revenue &amp; payroll</h2><div className="chart-legend"><span className="legend-red" />Revenue<span className="legend-dark" />Payroll</div></div>
                    <div className="chart-wrap"><ResponsiveContainer height="100%" width="100%"><AreaChart data={monthly} margin={{ left: -18, right: 6, top: 12, bottom: 0 }}><defs><linearGradient id="redFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#e10000" stopOpacity={0.24} /><stop offset="100%" stopColor="#e10000" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 6" vertical={false} /><XAxis axisLine={false} dataKey="month" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickLine={false} /><YAxis axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(value) => `$${value / 100}`} tickLine={false} /><Tooltip content={<ChartTooltip />} /><Area dataKey="payroll" fill="transparent" name="Payroll" stroke="var(--muted-foreground)" strokeDasharray="5 5" strokeWidth={2} type="monotone" /><Area dataKey="revenue" fill="url(#redFill)" name="Revenue" stroke="#e10000" strokeWidth={3} type="monotone" /></AreaChart></ResponsiveContainer></div>
                  </article>
                  <StripeMoneyFlow onMatch={openStripeMatch} summary={payload.stripeSummary} unmatchedPayments={payload.unmatchedStripePayments ?? []} />
                  <CategoryRevenue rentals={visibleRentals} />
                </div>
              </details>
            </div>
          )}

          {view === "rentals" && isOwner && <article className="panel page-panel">
            <div className="panel-heading page-heading">
              <div><h2>All appointments</h2><p>{filteredRentals.length} appointment{filteredRentals.length === 1 ? "" : "s"}{categoryFilter !== "all" || paymentFilter !== "all" ? " match your filters" : " in your records"}</p></div>
              {reviewRentals.length > 0 && <Button onClick={openPaymentOverride} size="sm" variant="outline"><ReceiptText size={15} /> Record payment received</Button>}
            </div>
            <div className="owner-appointment-filters">
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
                {(categoryFilter !== "all" || paymentFilter !== "all") && <Button variant="ghost" onClick={() => { setCategoryFilter("all"); setPaymentFilter("all"); }}>Clear filters</Button>}
            </div>
            {filteredRentals.length ? <RentalTable employeeId={employeeId} rentals={filteredRentals} /> : <EmptyState copy={categoryFilter === "all" && paymentFilter === "all" ? "Accepted appointments will appear after the next Calendar sync, scheduled every 5 minutes." : "No appointments match the selected filters."} title="No appointments found" />}
          </article>}
          {view === "team" && isOwner && <Tabs defaultValue="people" className="owner-team-tabs">
            <TabsList aria-label="Team sections"><TabsTrigger value="people">People</TabsTrigger><TabsTrigger value="engagement">Check-ins &amp; rewards</TabsTrigger></TabsList>
            <TabsContent value="people"><TeamPage payroll={payroll.state} employees={payload.employees} rentals={rentals} creative={creative.items} teamAccess={payload.teamAccess} onSetup={() => setTeamSetupOpen(true)} /></TabsContent>
            <TabsContent value="engagement"><TeamEngagementReview token={schedulingToken} /></TabsContent>
          </Tabs>}
          {view === "payouts" && <>
            {!isOwner && <div className="employee-earnings-heading"><div><h2>My earnings</h2><p>Appointment and creative work earnings by year.</p></div><label>Year<select value={earningsYear} onChange={event => setEarningsYear(Number(event.target.value))}>{earningsYears.map(year => <option key={year} value={year}>{year}</option>)}</select></label></div>}
            <PayoutPage payroll={payroll.state} employeeId={employeeId} employees={payload.employees} metrics={isOwner ? metrics : employeeEarnings.metrics} monthly={isOwner ? monthly : employeeEarnings.monthly} onContinue={openPayoutWorkflow} paidThrough={paidThrough} payoutEmployee={payoutEmployee} rentals={isOwner ? visibleRentals : employeeEarnings.rentals} setPaidThrough={setPaidThrough} setPayoutEmployee={setPayoutEmployee} />
            <CreativeWorkPage state={creative} employees={payload.employees} isOwner={isOwner} earningsOnly year={isOwner ? undefined : earningsYear} />
            {!isOwner && earningsYear === currentYear && <PeriodTotals creative={creative.items} employeeId={employeeId} rentals={visibleRentals} />}
            {!isOwner && employeeEarnings.rentals.length > 0 && <article className="panel employee-earnings-details"><div className="panel-heading"><div><h2>Earnings by appointment</h2><p>Upcoming amounts are estimates. Custom assignments are listed in Schedule.</p></div></div><RentalTable employeeId={employeeId} rentals={employeeEarnings.rentals} /></article>}
          </>}
          {view === "guide" && <StudioGuidePage isOwner={isOwner} draftPassword={sessionPassword} teamToken={schedulingToken} onPublish={publishStudioGuide} rulebook={payload.rulebook} />}
          {(view === "scheduling" || view === "availability") && <TeamSchedulingPage onChecklist={openChecklist} focusId={focusedAlert?.target === "scheduling" ? focusedAlert.id : undefined} onCloseFocus={() => setFocusedAlert(null)} availabilityOnly={view === "availability"} onAvailability={() => setView("availability")} isOwner={isOwner} token={schedulingToken} userId={payload.user.id} calendarSync={payload.calendarAssignmentSync} pastContent={!isOwner ? <article className="panel"><div className="panel-heading"><div><h2>Past appointments</h2><p>Completed appointments and their payment status.</p></div></div>{pastRentals.length ? <RentalTable employeeId={employeeId} rentals={pastRentals} /> : <EmptyState title="No past appointments yet" copy="Your completed appointments will appear here after syncing." />}</article> : undefined} onSetup={isOwner ? () => openWorkflow({ workflowId: "deploy-team-api.yml", title: "Activate team scheduling", description: "Deploy the scheduling backend to your existing Cloudflare Worker, prepare its database, and sync Calendar appointments and rental team notes.", actionLabel: "Deploy and activate", details: [{ label: "Worker", value: "smooth-studios-team-api" }, { label: "Database", value: "smooth-studios-team-db" }, { label: "Credentials", value: "Existing GitHub Actions secrets" }] }) : undefined} />}
        </div>
        <DashboardVersionFooter viewer={isOwner ? "owner" : "employee"} />
        </div>
      </SidebarInset>
      <MobileToolbar isOwner={isOwner} view={view} unread={alerts.unreadCount} onNavigate={navigate} />
      {isOwner && (
        <>
          <PaymentOverrideForm onContinue={openWorkflow} onOpenChange={setPaymentOverrideOpen} open={paymentOverrideOpen} reviewRentals={reviewRentals} />
          <StripeMatchForm initialPaymentId={stripeMatchPaymentId} onContinue={openWorkflow} onOpenChange={setStripeMatchOpen} open={stripeMatchOpen} payments={payload.unmatchedStripePayments ?? []} rentals={rentals} />
          <GithubWorkflowDialog access={payload.workflowAccess} onOpenChange={setWorkflowOpen} open={workflowOpen} request={workflowRequest} />
        </>
      )}
      </EmployeeEngagementProvider>
    </SidebarProvider>
  );
}

export function SmoothDashboard() {
  const [profiles, setProfiles] = useState<AccessProfile[]>(FALLBACK_PROFILES);
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [dark, setDark] = useState(false);
  const [sessionPassword, setSessionPassword] = useState("");
  const [schedulingToken, setSchedulingToken] = useState("");
  const sessionEpoch = useRef(0);
  const refreshSnapshot = useCallback(async () => {
    if (!payload || !sessionPassword) return false;
    const epoch = sessionEpoch.current;
    return refreshDashboardSnapshot({
      profile: { id: payload.user.id, role: payload.role }, password: sessionPassword,
      decrypt: decryptDashboard, isCurrent: () => epoch === sessionEpoch.current, onSnapshot: setPayload,
    });
  }, [payload, sessionPassword]);

  useEffect(() => {
    const savedTheme = localStorage.getItem("smooth-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const themeTimer = window.setTimeout(() => setDark(savedTheme ? savedTheme === "dark" : prefersDark), 0);
    return () => window.clearTimeout(themeTimer);
  }, []);

  useEffect(() => {
    if (payload) return;
    const controller = new AbortController();
    let latestRequest = 0;
    const refreshProfiles = async () => {
      const request = ++latestRequest;
      try {
        // GitHub Pages caches JSON for ten minutes. Account activation must
        // appear immediately, including after logout and returning to a tab.
        const response = await fetch(`./data/access.json?v=${Date.now()}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json() as { profiles: AccessProfile[] };
        if (!controller.signal.aborted && request === latestRequest && Array.isArray(data.profiles) && data.profiles.length) setProfiles(data.profiles);
      } catch { /* Keep the current list when the connection is unavailable. */ }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void refreshProfiles(); };
    void refreshProfiles();
    window.addEventListener("focus", refreshProfiles);
    window.addEventListener("pageshow", refreshProfiles);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      window.removeEventListener("focus", refreshProfiles);
      window.removeEventListener("pageshow", refreshProfiles);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [payload]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("smooth-theme", dark ? "dark" : "light");
  }, [dark]);

  const unlock = async (profile: AccessProfile, password: string) => {
    const epoch = ++sessionEpoch.current;
    const response = await fetch(`./data/${profile.id}.json`, { cache: "no-store" });
    if (!response.ok) throw new Error("Dashboard data is unavailable");
    const envelope = await response.json() as EncryptedEnvelope;
    const unlocked = await decryptDashboard(envelope, password);
    if (unlocked.user.id !== profile.id || unlocked.role !== profile.role) throw new Error("Invalid dashboard payload");
    const token = await teamToken(password, profile.id);
    if (epoch !== sessionEpoch.current) return;
    setSchedulingToken(token);
    setSessionPassword(password);
    rememberProfile(profile.id);
    // A fresh sign-in always starts at Home; notification links still navigate an open session.
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    setPayload(unlocked);
  };

  if (!payload) return <LoginScreen onUnlock={unlock} profiles={profiles} />;
  return <DashboardRefreshProvider><DashboardView dark={dark} onRefresh={refreshSnapshot} onLogout={() => { sessionEpoch.current++; void disableTeamPush(schedulingToken).catch(() => {}); setPayload(null); setSessionPassword(""); setSchedulingToken(""); }} payload={payload} sessionPassword={sessionPassword} schedulingToken={schedulingToken} setDark={setDark} /></DashboardRefreshProvider>;
}
