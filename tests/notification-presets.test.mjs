import assert from 'node:assert/strict';
import test from 'node:test';
import { createRentalReminderIntent, notificationPresetMessage, notificationRentalChoices, sameRentalReminder } from '../lib/notification-presets.mjs';
import { notificationText, notificationTime } from '../team-api/notification-content.mjs';

const now = Date.parse('2026-10-17T12:00:00Z');
const booking = { id: 'rental-a', title: 'Studio A Rental', start: '2026-10-18T03:30:00Z', end: '2026-10-18T05:00:00Z', acceptedEmployeeIds: ['akiva', 'rayne', 'owner', 'unknown'] };
const assignment = { id: 'offer-a', appointmentId: booking.id, employeeId: 'jordyn', title: booking.title, start: booking.start, end: booking.end, status: 'accepted' };
const schedule = (appointments = [booking], assignments = []) => ({ appointments, assignments });

test('rental choices require a real upcoming studio rental and only recorded confirmed staff contribute', () => {
  const result = notificationRentalChoices(schedule([
    booking,
    { ...booking, id: 'rental-b', title: 'Quick Studio Rental (Studio B)', start: '2026-10-19T16:00:00Z', end: '2026-10-19T17:00:00Z', acceptedEmployeeIds: [] },
    { ...booking, id: 'portrait', title: 'Studio portrait package' },
    { ...booking, id: 'past', start: '2026-10-16T12:00:00Z', end: '2026-10-16T13:00:00Z' },
    { ...booking, id: 'invalid', start: 'bad date' },
  ], [assignment, { ...assignment, id: 'duplicate' }, { ...assignment, id: 'cancel', employeeId: 'rayne', status: 'cancelled' },
    { ...assignment, id: 'pending', employeeId: 'dacari', status: 'pending' }, { ...assignment, id: 'declined', employeeId: 'sorayia', status: 'declined' },
    { ...assignment, id: 'stale', employeeId: 'amia', end: '2026-10-18T06:00:00Z' }]), now);
  assert.deepEqual(result.bookings.map(item => item.id), ['rental-a', 'rental-b']);
  assert.deepEqual(result.bookings[0].recipientIds, ['akiva', 'jordyn', 'rayne']);
  assert.deepEqual(result.bookings[1].recipientIds, [], 'unassigned rentals never default to Everyone');
});

test('response reminders remain bound to the actual pending app offer and its one assigned person', () => {
  const pending = { ...assignment, status: 'pending' };
  const result = notificationRentalChoices(schedule([{ ...booking, acceptedEmployeeIds: ['jordyn'] }], [pending,
    { ...pending, id: 'custom', appointmentId: null }, { ...pending, id: 'missing', appointmentId: 'removed' },
    { ...pending, id: 'stale', start: '2026-10-18T02:30:00Z' }, { ...pending, id: 'done', status: 'accepted' },
    { ...pending, id: 'unknown-person', employeeId: 'unknown' }]), now);
  assert.deepEqual(result.responses.map(item => item.id), ['offer-a']);
  assert.deepEqual(result.responses[0].recipientIds, ['jordyn']);
  const preview = notificationPresetMessage('rental-response', result.responses[0]);
  assert.equal(preview.title, 'Assignment response reminder');
  assert.equal(preview.body, notificationText(`${notificationText(pending.title, 120)} · ${notificationTime(pending.start, pending.end)}. Please accept or decline this offer in your dashboard.`, 360));
});

test('rental previews preserve the actual Eastern overnight time even with a long title', () => {
  const choice = notificationRentalChoices(schedule([{ ...booking, title: `Studio A Rental ${'long '.repeat(80)}` }]), now).bookings[0];
  const preview = notificationPresetMessage('upcoming-rental', choice);
  assert.match(preview.body, /Oct 17, 11:30 PM–Sun, Oct 18, 1:00 AM/);
  assert.ok(preview.body.length <= 360);
  assert.equal(preview.target, 'scheduling');
});

test('refresh comparison detects changed bookings, offers, dates, and confirmed staff without mutating the reviewed selection', () => {
  const original = notificationRentalChoices(schedule([booking], [{ ...assignment, status: 'pending' }]), now);
  const reviewed = structuredClone(original.bookings[0]);
  assert.equal(sameRentalReminder(reviewed, { ...reviewed, recipientIds: [...reviewed.recipientIds].reverse() }), true);
  for (const change of [{ id: 'new-booking' }, { title: 'Studio B Rental' }, { end: '2026-10-18T06:00:00Z' }, { recipientIds: ['akiva'] }]) {
    assert.equal(sameRentalReminder(reviewed, { ...reviewed, ...change }), false);
  }
  assert.equal(sameRentalReminder(original.responses[0], { ...original.responses[0], id: 'new-offer' }), false);
  assert.equal(sameRentalReminder(original.responses[0], { ...original.responses[0], bookingTitle: 'Studio B Rental' }), false);
  assert.equal(sameRentalReminder(reviewed, null), false);
  assert.deepEqual(reviewed, original.bookings[0]);
});

test('task presets open the right employee page and refresh instructions never require owner-only syncing', () => {
  assert.equal(notificationPresetMessage('availability').target, 'availability');
  assert.equal(notificationPresetMessage('calendar').target, 'settings');
  const refresh = notificationPresetMessage('refresh');
  assert.equal(refresh.target, 'scheduling'); assert.match(refresh.body, /pull down/); assert.doesNotMatch(refresh.body, /Sync now/);
  assert.equal(notificationPresetMessage('custom'), null);
});

test('uncertain rental response retries reuse their ID while a reoffered assignment gets a fresh intent', () => {
  let count = 0;
  const intent = createRentalReminderIntent(() => `id-${++count}`);
  const first = intent.prepare('offer-a');
  assert.deepEqual(intent.prepare('offer-a'), first);
  assert.notEqual(intent.prepare('new-offer-same-person-and-time').id, first.id);
  intent.clear(); assert.notEqual(intent.prepare('offer-a').id, first.id);
});

test('reviewing a changed rental time under the same assignment ID creates a fresh reminder intent', () => {
  const offer = notificationRentalChoices(schedule([booking], [{ ...assignment, status: 'pending' }]), now).responses[0];
  let count = 0;
  const intent = createRentalReminderIntent(() => `id-${++count}`);
  const first = intent.prepare(offer.id, offer);
  assert.deepEqual(intent.prepare(offer.id, structuredClone(offer)), first);
  const updated = { ...offer, start: '2026-10-19T03:30:00Z', end: '2026-10-19T05:00:00Z' };
  const reviewed = intent.prepare(updated.id, updated);
  assert.notEqual(reviewed.id, first.id, 'the old successful receipt cannot swallow a newly reviewed rental time');
  assert.deepEqual(intent.prepare(updated.id, updated), reviewed);
});
