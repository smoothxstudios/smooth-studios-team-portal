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
