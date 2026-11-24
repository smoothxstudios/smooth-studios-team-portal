import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadDashboardModule } from './helpers/load-dashboard-module.mjs';

const { AppointmentDetail } = loadDashboardModule('components/appointment-detail.tsx');
const appointment = { id: 'synthetic-rental', title: 'Studio A Rental', customer: 'Example Client',
  start: '2026-10-29T23:00:00Z', end: '2026-10-30T00:00:00Z', priceCents: 5000,
  rentalDetails: 'What color backdrop do you need set up?:\nWhite', acceptedEmployeeIds: ['rayne'] };
function render(payment) {
  return renderToStaticMarkup(createElement(AppointmentDetail, {
    item: { ...appointment, appointment: { ...appointment, ...payment }, assignments: [], confirmations: [], pendingIds: [] },
    userId: 'rayne', token: 'synthetic-token', isOwner: false, busy: false, feedback: null,
    renderAssignment: () => null, onAssign: () => {}, onRemovePerson: async () => true,
  }));
}

test('employee appointment renders backdrop and confirmed balance without owner payment controls', () => {
  const paid = render({ fullyPaid: true, paidOnlineCents: 5000 });
  assert.match(paid, /White/);
  assert.match(paid, /Paid in full<\/dt><dd>\$0\.00/);
  assert.doesNotMatch(paid, /Confirm with Smooth|Review payment/);
  assert.match(render({ fullyPaid: false, paidOnlineCents: 2000 }), /Balance remaining<\/dt><dd>\$30\.00/);
  assert.match(render({ fullyPaid: false, paidOnlineCents: null }), /Confirm with Smooth/);
  assert.match(render({ fullyPaid: false, paidOnlineCents: 5000 }), /Payment needs review/);
});


const { AssignmentOffer } = loadDashboardModule('components/scheduling/assignment-offer.tsx');
test('only owners see removal in appointment details for live and completed rentals', () => {
  for (const source of ["calendar", "app", "owner"]) for (const isOwner of [false, true]) for (const ended of [false, true]) {
    const rental = { ...appointment, start: new Date(Date.now() - 3600000).toISOString(), end: new Date(Date.now() + (ended ? -1000 : 3600000)).toISOString() };
    const offer = { ...rental, id: 'synthetic-offer', employeeId: 'rayne', appointmentId: rental.id, status: 'accepted', ownerConfirmation: source === 'owner' ? { confirmedBy: 'owner' } : undefined };
    const schedule = { appointments: [rental], assignments: source === "calendar" ? [] : [offer], blocks: [] };
    const html = renderToStaticMarkup(createElement(AppointmentDetail, {
      item: { ...rental, appointment: rental, assignments: schedule.assignments, confirmations: [{ employeeId: 'rayne', calendarAccepted: true }], pendingIds: [] },
      userId: isOwner ? 'owner' : 'rayne', token: 'synthetic-token', isOwner, busy: false, feedback: null,
      renderAssignment: (item, compact, onRemove) => createElement(AssignmentOffer, { item, compact, onRemove, schedule, isOwner, isHome: false, home: false, busy: false, needsRefresh: false, confirm: null }),
      onAssign: () => {}, onRemovePerson: async () => true,
    }));
    assert.equal(/>Remove person<|aria-label="Remove rayne from rental"/.test(html), isOwner, `source=${source}, owner=${isOwner}, ended=${ended}`);
  }
});
