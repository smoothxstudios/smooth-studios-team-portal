"use client";
import { HistoryGate } from "@/components/dashboard/history-gate";
import { expandHomeLedger } from "@/lib/dashboard-history.mjs";
import { OwnerWeeklyHours } from "@/components/dashboard/owner-weekly-hours";
import { AdvanceReview } from "@/components/dashboard/advance-review";
import { OwnerHomeLayout } from "@/components/dashboard/owner-home-layout";

import { AlertsPage,UnreadBadge } from "@/components/alerts";
import { CreativeWorkPage,CreativeWorkPreview } from "@/components/creative-work";
import { DashboardRefreshProvider,PullToRefresh,useRefreshSource } from "@/components/dashboard-refresh";
import { activateToolbarTab,scrollToolbarToTop } from "@/lib/toolbar-navigation.mjs";
import { DashboardSettings } from "@/components/dashboard-settings";
import { DashboardVersionFooter } from "@/components/dashboard-version-footer";
import { CategoryRevenue,OwnerFinancialSummary,PeriodTotals } from "@/components/dashboard/financial-summary";
import { LoginScreen } from "@/components/dashboard/login-screen";
import { CloseMobileMenu,DashboardNavigation,EMPLOYEE_NAV_ITEMS,MobileMenuButton,NAV_ITEMS,SettingsNavigation } from "@/components/dashboard/navigation";
import { OwnerAttention,OwnerUpcoming } from "@/components/dashboard/owner-overview";
import { PaymentOverrideForm,StripeMatchForm } from "@/components/dashboard/payment-forms";
import { PayoutPage } from "@/components/dashboard/payout-page";
import { RentalTable } from "@/components/dashboard/rental-table";
import { ChartTooltip,EmptyState,Logo } from "@/components/dashboard/shared";
import { StripeMoneyFlow } from "@/components/dashboard/stripe-money-flow";
import { TeamPage } from "@/components/dashboard/team-page";
import { GithubWorkflowDialog,type OwnerWorkflowRequest } from "@/components/github-workflow-dialog";
import { MobileToolbar } from "@/components/mobile-toolbar";
import { StudioGuidePage } from "@/components/studio-guide";
import { StudioInfoPage } from "@/components/studio-info";
import { TeamAccountSetup,type NewTeamSettings } from "@/components/team-account-setup";
import { EmployeeEngagementBar,EmployeeEngagementProvider,SmoothStarSidebar,TeamEngagementReview } from "@/components/team-engagement";
import { EventPlanner } from "@/components/event-planner";
import { TeamSchedulingPage } from "@/components/team-scheduling";
import { TeamNotifications } from "@/components/team-notifications";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
SidebarHeader,
SidebarInset,
SidebarProvider
} from "@/components/ui/sidebar";
import { Tabs,TabsContent,TabsList,TabsTrigger } from "@/components/ui/tabs";
import { APPOINTMENT_CATEGORIES } from "@/lib/appointment-categories.mjs";
import { rentalAlertTargetId } from "@/lib/alert-target.mjs";
import { creativeEarningDate,creativeEarnings } from "@/lib/creative-work.mjs";
import { decryptDashboard,encryptWorkflowPayload } from "@/lib/dashboard-crypto";
import type { PaymentFilter,ViewKey } from "@/lib/dashboard-presentation";
import { FALLBACK_PROFILES,appointmentCategory,customerPaymentState,dollars,eligibleForPayout,formatDate,formatTime,paidEarnings,rentalState,teamAccent,unpaidEarnings } from "@/lib/dashboard-presentation";
import { attachQuietSnapshotRefresh,createDashboardSnapshotReader,dashboardHasOpenEditor } from "@/lib/dashboard-refresh.mjs";
import type {
AccessProfile,
DashboardPayload,
EncryptedEnvelope,
StudioGuideline
} from "@/lib/dashboard-types";
import { employeeEarningsForYear } from "@/lib/employee-home.mjs";
import { recognizedRevenue } from "@/lib/owner-finances.mjs";
import { applyRentalAdvances } from "@/lib/payroll-advances.mjs";
import { rememberProfile } from "@/lib/quick-sign-in.mjs";
import { MAX_GUIDELINE_UPDATE_BYTES,createGuidePatch } from "@/lib/studio-guidelines.mjs";
import { attachTeamSession, closeTeamSession, openDashboardSession, sessionFetch, SESSION_ENDED_EVENT } from "@/lib/team-session.mjs";
import { disableTeamPush } from "@/lib/team-api";
import { teamToken } from "@/lib/team-auth.mjs";
import { TEAM,studioLocal } from "@/lib/team-schedule.mjs";
import { useAlerts,type DashboardAlert } from "@/lib/use-alerts";
import { NotificationDelivery } from "@/components/notification-delivery";
import { AddPay } from "@/components/dashboard/add-pay";
import { attachNotificationMessages, isNotificationHash } from "@/lib/notification-navigation.mjs";
import { useCreativeWork } from "@/lib/use-creative-work";
import { usePayroll } from "@/lib/use-payroll";
import {
BarChart3,
Bell,
ChevronDown,
LogOut,
ReceiptText
} from "lucide-react";
import { useCallback,useEffect,useMemo,useRef,useState } from "react";
import {
Area,
AreaChart,
CartesianGrid,
ResponsiveContainer,
Tooltip,
XAxis,
YAxis
} from "recharts";

function DashboardView({ payload, dark, setDark, onLogout, onRefresh, onLoadHistory, sessionPassword, schedulingToken }: { payload: DashboardPayload; dark: boolean; setDark: (value: boolean) => void; onLogout: () => void; onRefresh: () => Promise<boolean>; onLoadHistory: () => Promise<boolean>; sessionPassword: string; schedulingToken: string }) {
  useRefreshSource(onRefresh);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [view, setView] = useState<ViewKey>("overview");
  const [toolbarRefresh, setToolbarRefresh] = useState<{ id: number; arrival: Promise<boolean> } | null>(null);
  const [quietRefresh, setQuietRefresh] = useState(0);
  const toolbarScroll = useRef<ReturnType<typeof scrollToolbarToTop> | null>(null);
  const [focusedAlert, setFocusedAlert] = useState<{ target: string; id: string } | null>(null);
  const [alertWorkLoading, setAlertWorkLoading] = useState(false);
  const navigate = (next: ViewKey) => { toolbarScroll.current?.cancel(); toolbarScroll.current = null; setFocusedAlert(null); setView(next); };
  const navigateToolbar = (next: ViewKey) => activateToolbarTab({
    active: view, next, movement: toolbarScroll,
    scroll: () => scrollToolbarToTop(window), navigate,
    refreshDestination: () => { setToolbarRefresh(null); setQuietRefresh(value => value + 1); },
    refreshCurrent: arrival => setToolbarRefresh(previous => ({ id: (previous?.id ?? 0) + 1, arrival })),
  });
  useEffect(() => () => { toolbarScroll.current?.cancel(); }, []);
  const openChecklist = () => navigate("checklists");
  const alerts = useAlerts(schedulingToken, view === "alerts");
  const payroll = usePayroll(schedulingToken, payload.payroll);
  const creative = useCreativeWork(schedulingToken);
  const openAlert = async (alert: DashboardAlert) => {
    toolbarScroll.current?.cancel(); toolbarScroll.current = null;
    setFocusedAlert(alert.targetId ? { target: alert.target, id: alert.targetId } : null);
    if (alert.target === "quiz") {
      setView("overview");
      if (window.location.hash === "#daily-quiz") window.dispatchEvent(new Event("hashchange"));
      else window.location.hash = "#daily-quiz";
    } else if (alert.target === "creative" || alert.target === "payouts") {
      setView(alert.target); setAlertWorkLoading(true);
      try { await creative.refresh(); } finally { setAlertWorkLoading(false); }
    } else setView(alert.target === "settings" ? "settings" : alert.target === "alerts" ? "alerts" : alert.target === "availability" ? "availability" : "scheduling");
  };
  const creativeTotals = useMemo(() => creativeEarnings(creative.items), [creative.items]);
  const currentYear = Number(studioLocal(Date.now()).slice(0, 4));
  const [earningsYear, setEarningsYear] = useState(currentYear);
  const [teamSetupOpen, setTeamSetupOpen] = useState(false);
  const [teamSetupBusy, setTeamSetupBusy] = useState(false);
  useEffect(() => {
    if (payload.role === "owner" && window.location.hash.startsWith("#setup-team")) { setView("team"); setTeamSetupOpen(true); }
  }, [payload.role]);
  useEffect(() => {
    // Links and notification routes can change the view during a toolbar glide.
    // Stop its old target before positioning the newly opened page.
    toolbarScroll.current?.cancel(); toolbarScroll.current = null;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [view]);
  useEffect(() => {
    const openSchedule = () => {
      if (isNotificationHash(window.location.hash)) setFocusedAlert(null);
      if (window.location.hash === "#alerts") setView("alerts");
      if (window.location.hash === "#settings") setView("settings");
      if (window.location.hash === "#availability") setView("availability");
      if (window.location.hash === "#payouts") setView("payouts");
      if (window.location.hash === "#creative-work") setView("creative");
      if (window.location.hash === "#event-planner" && isOwner) setView("planner");
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
  const [paidThrough, setPaidThrough] = useState(() => studioLocal(Date.now()).slice(0, 10));
  const [payoutEmployee, setPayoutEmployee] = useState("all");
  const [paymentOverrideOpen, setPaymentOverrideOpen] = useState(false);
  const [paymentReviewRentalId, setPaymentReviewRentalId] = useState("");
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
      const month = Number(studioLocal(rental.start).slice(5, 7)) - 1;
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
        <PullToRefresh page={view} request={toolbarRefresh} quietRequestId={quietRefresh} />
        <div className="dashboard-refresh-body">
        <div className={`dashboard-content${!isOwner && view === "payouts" ? " employee-earnings-view" : ""}`}>
          {view === "alerts" && <AlertsPage isOwner={isOwner} state={alerts} onOpen={alert => void openAlert(alert)} action={isOwner ? <div className="alerts-owner-actions"><NotificationDelivery token={schedulingToken}/><TeamNotifications token={schedulingToken} employees={payload.employees} /></div> : undefined} />}
          {!isOwner && view === "overview" && <EmployeeEngagementBar />}
          {["overview", "team", "payouts"].includes(view) && creative.error && <p className="creative-notice" role="alert">Other work and pay totals could not be refreshed. <button onClick={() => void creative.refresh()}>Try again</button></p>}
          {view === "overview" && !isOwner && <CreativeWorkPreview state={creative} isOwner={false} onOpen={() => setView("creative")} />}
          {view === "payouts" && payroll.error && <p className="schedule-warning" role="status">{payroll.error}</p>}
          {view === "payouts" && isOwner && <AdvanceReview token={schedulingToken} payroll={payroll.state} employees={payload.employees} rentals={rentals} onSync={openCalendarSync} onFixPayment={id => { setPaymentReviewRentalId(id); setPaymentOverrideOpen(true); }} onReviewed={payroll.updateReviewSummary} onOpenSource={(kind, id) => {
            const target = kind === "rental" ? "scheduling" : "creative";
            const focusId = kind === "rental" ? rentalAlertTargetId(id) : id;
            setFocusedAlert(focusId ? { target, id: focusId } : null); setView(focusId ? target : "rentals");
            if (kind === "creative") void creative.refresh();
          }} />}
          {view === "settings" && <DashboardSettings token={schedulingToken} profile={{ id: payload.user.id, label: displayName, role: payload.role }} password={sessionPassword} dark={dark} onThemeChange={setDark} onSync={isOwner ? openCalendarSync : undefined} lastSynced={`${formatDate(payload.generatedAt, true)} · ${formatTime(payload.generatedAt)}`} />}
          {view === "checklists" && <StudioInfoPage token={schedulingToken} isOwner={isOwner} userId={payload.user.id} section="checklists" />}
          {view === "creative" && <CreativeWorkPage state={creative} employees={payload.employees} isOwner={isOwner} focusLoading={alertWorkLoading} focusId={focusedAlert?.target === "creative" ? focusedAlert.id : undefined} onCloseFocus={() => setFocusedAlert(null)} />}
          {view === "overview" && !isOwner && <TeamSchedulingPage onChecklist={openChecklist} token={schedulingToken} userId={payload.user.id} isOwner={false} home={{ rentals: visibleRentals, owed: metrics.owed, advance, onAvailability: () => setView("availability"), onSchedule: () => setView("scheduling"), onEarnings: () => setView("payouts"), onGuide: () => setView("guide"), onChecklist: openChecklist }} />}
          {view === "overview" && isOwner && (
            <OwnerHomeLayout token={schedulingToken} sections={{
              upcoming: <OwnerUpcoming rentals={upcoming} onSchedule={() => setView("scheduling")} />,
              attention: <OwnerAttention reviewCount={reviewRentals.length} unmatchedCount={payload.stripeSummary?.unmatchedPaymentCount ?? payload.unmatchedStripePayments?.length ?? 0} stripeConnected={stripeConnected} onReview={reviewPayments} onMatch={() => openStripeMatch()} onPayouts={() => setView("payouts")} />,
              finances: <OwnerFinancialSummary rentals={visibleRentals} creative={creative} upcomingCount={upcoming.length} totalOwed={metrics.owed} onSchedule={() => setView("scheduling")} onPayouts={() => setView("payouts")} />,
              hours: <OwnerWeeklyHours employees={payload.employees} rentals={rentals} token={schedulingToken} />,
              creative: <CreativeWorkPreview state={creative} isOwner onOpen={() => setView("creative")} />,
              reports: <details className="owner-reports" onToggle={event => setReportsOpen(event.currentTarget.open)}>
                <summary>
                  <span className="owner-reports-icon"><BarChart3 size={21} /></span>
                  <span className="owner-reports-copy"><strong>Financial reports</strong><small>Revenue, Stripe, and category breakdowns</small></span>
                  <span className="owner-reports-toggle"><span className="reports-show">Show reports</span><span className="reports-hide">Hide reports</span><ChevronDown size={18} /></span>
                </summary>
                {reportsOpen && <HistoryGate deferred={payload.history?.deferred} load={onLoadHistory}><div className="owner-reports-content">
                  <PeriodTotals creative={creative.items} rentals={visibleRentals} />
                  <article className="panel trend-panel">
                    <div className="panel-heading"><h2>Revenue &amp; payroll</h2><div className="chart-legend"><span className="legend-red" />Revenue<span className="legend-dark" />Payroll</div></div>
                    <div className="chart-wrap"><ResponsiveContainer height="100%" width="100%"><AreaChart data={monthly} margin={{ left: -18, right: 6, top: 12, bottom: 0 }}><defs><linearGradient id="redFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#e10000" stopOpacity={0.24} /><stop offset="100%" stopColor="#e10000" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 6" vertical={false} /><XAxis axisLine={false} dataKey="month" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickLine={false} /><YAxis axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(value) => `$${value / 100}`} tickLine={false} /><Tooltip content={<ChartTooltip />} /><Area dataKey="payroll" fill="transparent" name="Payroll" stroke="var(--muted-foreground)" strokeDasharray="5 5" strokeWidth={2} type="monotone" /><Area dataKey="revenue" fill="url(#redFill)" name="Revenue" stroke="#e10000" strokeWidth={3} type="monotone" /></AreaChart></ResponsiveContainer></div>
                  </article>
                  <StripeMoneyFlow onMatch={openStripeMatch} summary={payload.stripeSummary} unmatchedPayments={payload.unmatchedStripePayments ?? []} />
                  <CategoryRevenue rentals={visibleRentals} />
                </div></HistoryGate>}
              </details>,
            }} />
          )}

          {view === "rentals" && isOwner && <HistoryGate deferred={payload.history?.deferred} load={onLoadHistory}><article className="panel page-panel">
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
          </article></HistoryGate>}
          {view === "team" && isOwner && <Tabs defaultValue="people" className="owner-team-tabs">
            <TabsList aria-label="Team sections"><TabsTrigger value="people">People</TabsTrigger><TabsTrigger value="engagement">Check-ins &amp; rewards</TabsTrigger></TabsList>
            <TabsContent value="people"><HistoryGate deferred={payload.history?.deferred} load={onLoadHistory}><TeamPage token={schedulingToken} payroll={payroll.state} employees={payload.employees} rentals={rentals} creative={creative.items} onSetup={() => setTeamSetupOpen(true)} /></HistoryGate></TabsContent>
            <TabsContent value="engagement"><TeamEngagementReview token={schedulingToken} /></TabsContent>
          </Tabs>}
          {view === "payouts" && <HistoryGate deferred={payload.history?.deferred} load={onLoadHistory}>
            {!isOwner && <div className="employee-earnings-heading"><div><h2>My earnings</h2><p>Appointment, training, and other work earnings by year.</p></div><label>Year<select value={earningsYear} onChange={event => setEarningsYear(Number(event.target.value))}>{earningsYears.map(year => <option key={year} value={year}>{year}</option>)}</select></label></div>}
            <PayoutPage addPay={isOwner ? <AddPay token={schedulingToken} employees={payload.employees} state={creative} /> : undefined} creative={creative.items} payroll={payroll.state} employeeId={employeeId} employees={payload.employees} metrics={isOwner ? metrics : employeeEarnings.metrics} monthly={isOwner ? monthly : employeeEarnings.monthly} onContinue={openPayoutWorkflow} paidThrough={paidThrough} payoutEmployee={payoutEmployee} rentals={isOwner ? visibleRentals : employeeEarnings.rentals} setPaidThrough={setPaidThrough} setPayoutEmployee={setPayoutEmployee} />
            <CreativeWorkPage state={creative} employees={payload.employees} isOwner={isOwner} earningsOnly focusLoading={alertWorkLoading} focusId={focusedAlert?.target === "payouts" ? focusedAlert.id : undefined} onCloseFocus={() => setFocusedAlert(null)} year={isOwner ? undefined : earningsYear} />
            {!isOwner && earningsYear === currentYear && <PeriodTotals creative={creative.items} employeeId={employeeId} rentals={visibleRentals} />}
            {!isOwner && employeeEarnings.rentals.length > 0 && <article className="panel employee-earnings-details"><div className="panel-heading"><div><h2>Earnings by appointment</h2><p>Upcoming amounts are estimates. Custom assignments are listed in Schedule.</p></div></div><RentalTable employeeId={employeeId} rentals={employeeEarnings.rentals} /></article>}
          </HistoryGate>}
          {view === "guide" && <StudioGuidePage isOwner={isOwner} draftPassword={sessionPassword} teamToken={schedulingToken} onPublish={publishStudioGuide} rulebook={payload.rulebook} />}
          {view === "planner" && isOwner && <EventPlanner token={schedulingToken} onSchedule={() => setView("scheduling")} onAvailability={() => setView("availability")} />}
          {(view === "scheduling" || view === "availability") && <TeamSchedulingPage onChecklist={openChecklist} focusId={focusedAlert?.target === "scheduling" ? focusedAlert.id : undefined} onCloseFocus={() => setFocusedAlert(null)} availabilityOnly={view === "availability"} onAvailability={() => setView("availability")} isOwner={isOwner} token={schedulingToken} userId={payload.user.id} calendarSync={payload.calendarAssignmentSync} pastContent={!isOwner ? <HistoryGate deferred={payload.history?.deferred} load={onLoadHistory}><article className="panel"><div className="panel-heading"><div><h2>Past appointments</h2><p>Completed appointments and their payment status.</p></div></div>{pastRentals.length ? <RentalTable employeeId={employeeId} rentals={pastRentals} /> : <EmptyState title="No past appointments yet" copy="Your completed appointments will appear here after syncing." />}</article></HistoryGate> : undefined} onSetup={isOwner ? () => openWorkflow({ workflowId: "deploy-team-api.yml", title: "Activate team scheduling", description: "Deploy the scheduling backend to your existing Cloudflare Worker, prepare its database, and sync Calendar appointments and rental team notes.", actionLabel: "Deploy and activate", details: [{ label: "Worker", value: "smooth-studios-team-api" }, { label: "Database", value: "smooth-studios-team-db" }, { label: "Credentials", value: "Existing GitHub Actions secrets" }] }) : undefined} />}
        </div>
        <DashboardVersionFooter viewer={isOwner ? "owner" : "employee"} />
        </div>
      </SidebarInset>
      <MobileToolbar isOwner={isOwner} view={view} unread={alerts.unreadCount} onNavigate={navigateToolbar} />
      {isOwner && (
        <>
          {paymentOverrideOpen && <HistoryGate deferred={payload.history?.deferred} load={onLoadHistory} onCancel={() => setPaymentOverrideOpen(false)}><PaymentOverrideForm onContinue={openWorkflow} onOpenChange={open => { setPaymentOverrideOpen(open); if (!open) setPaymentReviewRentalId(""); }} open={paymentOverrideOpen} initialEventId={paymentReviewRentalId} reviewRentals={reviewRentals} /></HistoryGate>}
          {stripeMatchOpen && <HistoryGate deferred={payload.history?.deferred} load={onLoadHistory} onCancel={() => setStripeMatchOpen(false)}><StripeMatchForm initialPaymentId={stripeMatchPaymentId} onContinue={openWorkflow} onOpenChange={setStripeMatchOpen} open={stripeMatchOpen} payments={payload.unmatchedStripePayments ?? []} rentals={rentals} /></HistoryGate>}
          <GithubWorkflowDialog access={payload.workflowAccess} onOpenChange={setWorkflowOpen} open={workflowOpen} request={workflowRequest} />
        </>
      )}
      </EmployeeEngagementProvider>
    </SidebarProvider>
  );
}

export function SmoothDashboard() {
  useEffect(() => attachNotificationMessages(window), []);
  const [profiles, setProfiles] = useState<AccessProfile[]>(FALLBACK_PROFILES);
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [dark, setDark] = useState(false);
  const [sessionPassword, setSessionPassword] = useState("");
  const [schedulingToken, setSchedulingToken] = useState("");
  const [signInNotice, setSignInNotice] = useState("");
  const sessionEpoch = useRef(0);
  const snapshotReader = useRef<ReturnType<typeof createDashboardSnapshotReader> | null>(null);
  const loadHistory = useCallback(() => snapshotReader.current?.loadHistory() ?? Promise.resolve(false), []);
  const refreshSnapshot = useCallback(() => snapshotReader.current?.() ?? Promise.resolve(false), []);
  const signedIn = Boolean(payload);
  const lockSession = useCallback(() => {
    sessionEpoch.current++; snapshotReader.current = null;
    setPayload(null); setSessionPassword(""); setSchedulingToken("");
  }, []);
  useEffect(() => {
    if (!schedulingToken) return;
    const expired = (event: Event) => {
      if ((event as CustomEvent).detail?.token === schedulingToken) { setSignInNotice("Your session ended. Sign in again to continue."); lockSession(); }
    };
    window.addEventListener(SESSION_ENDED_EVENT, expired);
    const detach = attachTeamSession(schedulingToken);
    return () => { detach(); window.removeEventListener(SESSION_ENDED_EVENT, expired); };
  }, [schedulingToken, lockSession]);
  useEffect(() => {
    if (signedIn) {
      if ("serviceWorker" in navigator) void navigator.serviceWorker.getRegistration(new URL("./", window.location.href).href).then(registration => registration?.update()).catch(() => {});
      return attachQuietSnapshotRefresh(refreshSnapshot);
    }
  }, [signedIn, refreshSnapshot]);

  useEffect(() => {
    let savedTheme: string | null = null;
    try { savedTheme = localStorage.getItem("smooth-theme"); } catch { /* Use device appearance when storage is unavailable. */ }
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
    try { localStorage.setItem("smooth-theme", dark ? "dark" : "light"); } catch { /* Appearance still works for this session. */ }
  }, [dark]);

  const unlock = async (profile: AccessProfile, password: string) => {
    setSignInNotice("");
    const epoch = ++sessionEpoch.current;
    const { token, dashboard } = await openDashboardSession(await teamToken(password, profile.id), profile.id);
    let initialTag = dashboard?.etag ?? null;
    let envelope: EncryptedEnvelope, unlocked: DashboardPayload;
    try {
      if (dashboard?.envelope) envelope = dashboard.envelope;
      else {
        // Compatible with the previous server during a rolling deployment.
        const response = await sessionFetch(token, "/dashboard");
        if (!response.ok) throw new Error("Dashboard data is unavailable. Please try again.");
        envelope = await response.json() as EncryptedEnvelope;
        initialTag = response.headers.get("etag");
      }
      unlocked = expandHomeLedger(await decryptDashboard(envelope, password));
      if (unlocked.user.id !== profile.id || unlocked.role !== profile.role) throw new Error("Invalid dashboard payload");
    } catch (error) { void closeTeamSession(token).catch(() => {}); throw error; }
    if (epoch !== sessionEpoch.current) { void closeTeamSession(token).catch(() => {}); return; }
    snapshotReader.current = createDashboardSnapshotReader({
      profile: { id: profile.id, role: profile.role }, password,
      decrypt: decryptDashboard, isCurrent: () => epoch === sessionEpoch.current, onSnapshot: setPayload,
      canApply: () => !dashboardHasOpenEditor(),
      fetcher: (url: RequestInfo | URL, options?: RequestInit) => { const target = new URL(String(url)); return sessionFetch(token, target.pathname + target.search, options); },
    }, unlocked, envelope, initialTag);
    setSchedulingToken(token);
    setSessionPassword(password);
    rememberProfile(profile.id);
    // Every successful sign-in starts at Home, including saved notification links.
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    setPayload(unlocked);
  };

  if (!payload) return <LoginScreen onUnlock={unlock} profiles={profiles} notice={signInNotice} />;
  return <DashboardRefreshProvider><DashboardView dark={dark} onLoadHistory={loadHistory} onRefresh={refreshSnapshot} onLogout={() => {
    const token = schedulingToken;
    setSignInNotice(""); lockSession();
    void disableTeamPush(token).catch(() => {});
    void closeTeamSession(token).catch(() => {});
  }} payload={payload} sessionPassword={sessionPassword} schedulingToken={schedulingToken} setDark={setDark} /></DashboardRefreshProvider>;
}
