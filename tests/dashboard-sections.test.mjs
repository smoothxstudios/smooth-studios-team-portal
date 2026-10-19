import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { mock } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadDashboardModule } from './helpers/load-dashboard-module.mjs';

const now = Date.parse('2026-10-17T07:00:00Z');
mock.timers.enable({ apis: ['Date'], now });
test.after(() => mock.timers.reset());
const display = loadDashboardModule('lib/dashboard-presentation.ts');
const rentalUI = loadDashboardModule('components/dashboard/rental-table.tsx');
const shared = loadDashboardModule('components/dashboard/shared.tsx');
const financial = loadDashboardModule('components/dashboard/financial-summary.tsx');
const overview = loadDashboardModule('components/dashboard/owner-overview.tsx');
const stripe = loadDashboardModule('components/dashboard/stripe-money-flow.tsx');
const team = loadDashboardModule('components/dashboard/team-page.tsx');
const payout = loadDashboardModule('components/dashboard/payout-page.tsx');
const forms = loadDashboardModule('components/dashboard/payment-forms.tsx');
const login = loadDashboardModule('components/dashboard/login-screen.tsx');
const navigation = loadDashboardModule('components/dashboard/navigation.tsx');
const { SidebarProvider } = loadDashboardModule('components/ui/sidebar.tsx');
const noop = () => {};
const earned = {
  id: 'synthetic-rental', stripeMatchKey: 'synthetic-match', title: 'Studio Rental', customer: 'Example Customer',
  start: '2026-10-16T13:00:00Z', end: '2026-10-16T15:00:00Z', priceCents: 10000,
  paidOnlineCents: 10000, fullyPaid: true, paymentSource: 'calendar',
  assignedEmployeeIds: ['jordyn'],
  employeePayouts: { jordyn: { amountCents: 3000, paidAmountCents: 1000, outstandingCents: 2000, paid: false } },
};
const upcoming = { ...earned, id: 'future', start: '2026-10-20T13:00:00Z', end: '2026-10-20T15:00:00Z' };
const employee = { id: 'jordyn', name: 'Jordyn', accent: '#123456' };
const money = { generatedAt: '2026-10-17T06:00:00Z', paymentCount: 1, grossCents: 10000, refundedCents: 0, feeCents: 300, netCents: 9700, bankPayoutCents: 9700, pendingPayoutCents: 0, matchedPaymentCount: 1, unmatchedPaymentCount: 0, unmatchedCents: 0, disputedPaymentCount: 0 };
const render = (Component, props) => renderToStaticMarkup(createElement(Component, props));
const renderNavigation = (Component, props) => renderToStaticMarkup(createElement(SidebarProvider, null, createElement(Component, props)));

test('shared money, duration and Eastern date formatting retain their display contracts', () => {
  assert.equal(display.dollars(12345, true), '$123.45');
  assert.equal(display.dollars(12345), '$123');
  assert.equal(display.formatTime(upcoming.start), '9:00 AM');
  assert.equal(display.formatDate(upcoming.start, true), 'Oct 20');
  assert.equal(display.durationLabel(earned), '2 hr');
  assert.equal(display.durationLabel({ ...earned, end: '2026-10-16T13:30:00Z' }), '30 min');
  assert.equal(display.formatDate('2026-10-17T02:00:00Z', true), 'Oct 16');
});

test('partial payouts and advance-adjusted outstanding amounts are preserved', () => {
  assert.equal(display.paidEarnings(earned.employeePayouts.jordyn), 1000);
  assert.equal(display.unpaidEarnings(earned.employeePayouts.jordyn), 2000);
  assert.equal(display.paidEarnings({ amountCents: 3000, paid: true }), 3000);
  assert.equal(display.unpaidEarnings({ amountCents: 3000, paidAmountCents: 4000, paid: true }), 0);
  assert.equal(display.unpaidEarnings({ amountCents: 3000, paidAmountCents: 1000, outstandingCents: 500, paid: false }), 500);
  assert.equal(display.paidEarnings(), 0);
  assert.equal(display.unpaidEarnings(), 0);
});

test('completed and future appointments keep payment and payout review distinctions', () => {
  assert.equal(display.customerPaymentState(earned), 'paid');
  assert.equal(display.customerPaymentState({ ...upcoming, paidOnlineCents: 2500, fullyPaid: false }), 'deposit');
  assert.equal(display.customerPaymentState({ ...earned, paidOnlineCents: 2500, fullyPaid: false }), 'review');
  assert.equal(display.customerPaymentState({ ...upcoming, paidOnlineCents: 0, fullyPaid: false }), 'pending');
  assert.equal(display.appointmentStatus(earned), 'customer-paid');
  assert.equal(display.appointmentStatus(earned, 'jordyn'), 'earned');
  assert.equal(display.appointmentStatus(upcoming, 'jordyn'), 'upcoming-paid');
  assert.equal(display.eligibleForPayout(earned, '2026-10-16', 'jordyn'), true);
  assert.equal(display.eligibleForPayout(earned, '2026-10-15', 'jordyn'), false);
  assert.equal(display.eligibleForPayout(upcoming, '2026-10-31', 'all'), false);
});

test('manual payment overrides still take precedence over recorded online totals', () => {
  const blocked = { ...earned, paymentOverride: false, fullyPaid: false };
  assert.equal(display.customerPaymentState(blocked), 'review');
  assert.equal(display.eligibleForPayout(blocked, '2026-10-16', 'all'), false);
  assert.match(render(rentalUI.PaymentAmount, { rental: blocked, showDetails: true }), /marked not fully paid/);
});

test('Stripe matching normalization and ranking remain deterministic', () => {
  assert.equal(display.normalizedMatchText(' EXAMPLE -- Customer! '), 'example customer');
  const payment = { customerName: 'Example Customer', amountCents: 10000, created: earned.start };
  assert.equal(display.stripeAppointmentScore(payment, earned), 185);
  assert.ok(display.stripeAppointmentScore(payment, earned) > display.stripeAppointmentScore({ ...payment, customerName: 'Different', amountCents: 5000 }, earned));
});

test('appointment tables retain different owner and employee views', () => {
  const owner = render(rentalUI.RentalTable, { rentals: [earned] });
  const member = render(rentalUI.RentalTable, { rentals: [earned], employeeId: 'jordyn' });
  assert.match(owner, /Assigned team/);
  assert.match(owner, /Price \/ recorded payment/);
  assert.match(member, /Your earnings/);
  assert.doesNotMatch(member, /Assigned team|Price \/ recorded payment/);
  assert.match(member, /\$10\.00 paid/);
  assert.match(member, /\$20\.00 still owed/);
});

test('missing rates and tips retain their existing presentation', () => {
  assert.match(render(rentalUI.EmployeeEarnings, { payout: { amountCents: 0, paid: false, compensationConfigured: false } }), /Rate needed/);
  assert.match(render(rentalUI.PaymentAmount, { rental: { ...earned, paidOnlineCents: 12000 }, showDetails: true }), /\$20\.00 tip/);
});

test('navigation retains employee labels and hides owner-only destinations', () => {
  const owner = renderNavigation(navigation.DashboardNavigation, { isOwner: true, accountId: 'owner', view: 'overview', onNavigate: noop, unread: 2 });
  const member = renderNavigation(navigation.DashboardNavigation, { isOwner: false, accountId: 'jordyn', view: 'overview', onNavigate: noop, unread: 2 });
  assert.match(owner, /Team Schedule/);
  assert.match(member, /My Schedule/);
  assert.match(member, /My Availability/);
  assert.doesNotMatch(member, /<span>Appointments<\/span>|<span>Team<\/span>|<span>Payouts<\/span>/);
  assert.match(owner, /account=smooth/);
  assert.match(member, /account=jordyn/);
  assert.match(member, /rel="noopener noreferrer"/);
});

test('initial sign-in remains locked and does not invoke account unlock during render', () => {
  let invoked = false;
  const markup = render(login.LoginScreen, { profiles: [{ id: 'owner', label: 'Smooth', role: 'owner' }], onUnlock: async () => { invoked = true; } });
  assert.match(markup, /Preparing sign-in/);
  assert.equal(invoked, false);
});

test('dashboard modules have no dependency back into the orchestration component', () => {
  const directory = new URL('../components/dashboard/', import.meta.url);
  const files = fs.readdirSync(directory).filter(file => file.endsWith('.tsx'));
  assert.ok(files.includes('owner-overview.tsx') && files.includes('payout-page.tsx'));
  for (const file of files) assert.doesNotMatch(fs.readFileSync(new URL(file, directory), 'utf8'), /from\s+['"][^'"]*smooth-dashboard/);
  const pure = fs.readFileSync(new URL('../lib/dashboard-presentation.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(pure, /from\s+['"](?:react|@\/components\/)/);
  const source = fs.readFileSync(new URL('../components/smooth-dashboard.tsx', import.meta.url), 'utf8');
  for (const name of ['LoginScreen', 'TeamPage', 'PayoutPage', 'RentalTable', 'StripeMatchForm']) assert.ok(!source.includes(`function ${name}(`), `${name} belongs in its own module`);
});

// The refactor verification run also renders the exact pre-extraction source.
// Ordinary test runs do not need to keep a duplicate of the old dashboard.
if (process.env.DASHBOARD_COMPARE_BEFORE === '1') {
  const before = loadDashboardModule('.github/dashboard-before.tsx');
  const cases = [
    [shared, 'Logo', {}], [shared, 'EmptyState', { title: 'Nothing here', copy: 'Synthetic fixture' }],
    [shared, 'ChartTooltip', { active: true, label: 'October', payload: [{ name: 'Paid', value: 12345, color: 'red' }] }],
    [login, 'LoginScreen', { profiles: [{ id: 'owner', label: 'Smooth', role: 'owner' }], onUnlock: async () => {} }],
    [financial, 'OwnerFinancialSummary', { rentals: [earned], creative: { items: [], loaded: true, error: '' }, upcomingCount: 1, totalOwed: 2000, onSchedule: noop, onPayouts: noop }],
    [financial, 'PeriodTotals', { rentals: [earned], employeeId: 'jordyn', creative: [] }],
    [financial, 'CategoryRevenue', { rentals: [earned] }],
    [stripe, 'StripeMoneyFlow', { summary: money, unmatchedPayments: [], onMatch: noop }],
    [stripe, 'StripeMoneyFlow', { unmatchedPayments: [], onMatch: noop }],
    [overview, 'OwnerAttention', { reviewCount: 2, unmatchedCount: 1, stripeConnected: true, onReview: noop, onMatch: noop, onPayouts: noop }],
    [overview, 'OwnerUpcoming', { rentals: [upcoming], onSchedule: noop }],
    [overview, 'OwnerUpcoming', { rentals: [], onSchedule: noop }],
    [rentalUI, 'RentalTable', { rentals: [earned] }],
    [rentalUI, 'RentalTable', { rentals: [earned], employeeId: 'jordyn' }],
    [team, 'TeamPage', { employees: [employee], rentals: [earned, upcoming], creative: [], onSetup: noop }],
    [payout, 'PayoutPage', { employeeId: 'jordyn', employees: [employee], metrics: { revenue: 10000, paid: 1000, owed: 2000, projected: 3000 }, monthly: [], onContinue: noop, paidThrough: '2026-10-16', payoutEmployee: 'jordyn', rentals: [earned], setPaidThrough: noop, setPayoutEmployee: noop }],
    [forms, 'PaymentOverrideForm', { open: false, onOpenChange: noop, onContinue: noop, reviewRentals: [] }],
    [forms, 'StripeMatchForm', { open: false, onOpenChange: noop, onContinue: noop, payments: [], rentals: [], initialPaymentId: '' }],
  ];
  for (const [module, name, props] of cases) test(`pre-refactor rendering parity: ${name}${props.employeeId ? ' employee' : ''}`, () => {
    assert.equal(render(module[name], props), render(before[name], props));
  });
  for (const isOwner of [true, false]) test(`pre-refactor navigation parity: ${isOwner ? 'owner' : 'employee'}`, () => {
    const props = { isOwner, accountId: isOwner ? 'owner' : 'jordyn', view: 'overview', onNavigate: noop, unread: 3 };
    assert.equal(renderNavigation(navigation.DashboardNavigation, props), renderNavigation(before.DashboardNavigation, props));
  });
}

test('period totals place manual pay on its work date, not the later approval date', () => {
  const html = render(financial.PeriodTotals, {rentals:[], employeeId:'jordyn', creative:[{
    id:'manual-fixture',employeeId:'jordyn',entryType:'manual',status:'approved',amountCents:2500,
    earnedAt:'2026-10-09T04:00:00.000Z',approvedAt:'2026-10-17T06:00:00.000Z',payments:[],
  }]});
  const sections = html.split('class="period-total"');
  assert.match(sections[1], /This week<\/span><strong>\$0<\/strong>/);
  assert.match(sections[2], /This month<\/span><strong>\$25<\/strong>/);
  assert.match(sections[3], /This year<\/span><strong>\$25<\/strong>/);
});
