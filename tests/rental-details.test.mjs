import assert from 'node:assert/strict';
import test from 'node:test';
import { rentalDetails, rentalSetupDetails } from '../lib/rental-details.mjs';
import { fixture } from './helpers/notification-fixture.mjs';
import { normalizeCalendarEvent } from '../scripts/lib/dashboard-data.mjs';
import { syncTeamSchedule } from '../scripts/lib/team-api.mjs';
import { appointmentBalance } from '../lib/daily-actions.mjs';
const description = `[Smooth Studios rental team]\nAkiva — Accepted\n[/Smooth Studios rental team]\nCalendar: Smooth Studios\nName: Client\nPhone: PRIVATE_PHONE\nEmail: PRIVATE_EMAIL\nPrice: $100\nPaid Online: $100\nStudio Rental Form\n====\nWhat type of photoshoot are you doing?:\nBirthday portraits\nBackdrop colors: Blue &amp; white\nEquipment needed:\nTwo strobes\nSoftbox\nEmail: PRIVATE_EMAIL\nBooking link: https://example.invalid/private\nAcuityID=PRIVATE_ID`;

test('Studio A and B booking forms survive Calendar normalization, incremental sync and employee access', async t => {
  const f = await fixture(); delete f.env.VAPID_JWK; t.after(() => f.close());
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const result = await f.call('sync', new URL(url).pathname, options.body ? JSON.parse(options.body) : undefined);
    return Response.json(result.data, { status: result.status });
  });
  const config = { importStart: '2026-01-01', timeZone: 'America/New_York', commissionRate: 0.3,
    employees: [{ id: 'rayne', email: 'rayne@example.invalid' }] };
  const rentals = ['Studio Rental', 'Studio A Rental', 'Studio B Rental'].map((title, index) => normalizeCalendarEvent({
    id: `studio-form-${index}`, summary: `Example Client: ${title} (Smooth Studios)`,
    start: { dateTime: '2026-10-29T19:00:00-04:00' }, end: { dateTime: '2026-10-29T20:00:00-04:00' },
    attendees: [{ email: 'rayne@example.invalid', responseStatus: 'accepted' }],
    description: `[Smooth Studios rental team]\nRayne — Accepted in app\n[/Smooth Studios rental team]\nCalendar: Smooth Studios\nName: Example Client\nPrice: $50.00\nPaid Online: $50.00\n${title} Form\n================\nWhat type of photoshoot are you doing?: Organization Photoshoot\nWhat color backdrop do you need set up?: White\nDo you need any props or accessories for your shoot? (Leave blank if you don't):\nChange Appointment: https://example.invalid/PRIVATE\nAcuityID=PRIVATE_ID`,
  }, config, { employees: {} }));
  // Seed the old blank records to exercise the same incremental repair as production.
  await syncTeamSchedule(rentals.map(rental => ({ ...rental, rentalDetails: '' })), 'synthetic-owner-password', null, new Date(Date.now() - 1000).toISOString());
  await syncTeamSchedule(rentals, 'synthetic-owner-password', null, new Date().toISOString());
  for (const role of ['owner', 'rayne']) {
    const view = (await f.call(role, '/schedule')).data;
    assert.equal(view.appointments.length, 3);
    for (const appointment of view.appointments) {
      assert.match(appointment.rentalDetails, /Organization Photoshoot/, appointment.title);
      assert.match(appointment.rentalDetails, /What color backdrop do you need set up\?:\nWhite/);
      assert.doesNotMatch(appointment.rentalDetails, /PRIVATE|Accepted in app|Change Appointment/);
      assert.deepEqual(appointmentBalance(appointment), { label: 'Paid in full', remaining: 0 });
    }
  }
  assert.equal((await f.call('jordyn', '/schedule')).data.appointments.length, 0);
});
test('Home setup shows backdrop, shoot and equipment without repeating contact and billing fields', () => {
  const setup = rentalSetupDetails(rentalDetails(description));
  assert.match(setup, /Birthday portraits/);
  assert.match(setup, /Backdrop colors:\nBlue & white/);
  assert.match(setup, /Equipment needed:\nTwo strobes\nSoftbox/);
  assert.doesNotMatch(setup, /PRIVATE_|Paid Online|Price:|Calendar:|Name:|Studio Rental Form/);
  assert.equal(rentalSetupDetails(undefined), '');
});
test('booking descriptions include contact, price and form answers while stripping admin links and team notes', () => {
  const details = rentalDetails(description);
  assert.match(details, /Birthday portraits/); assert.match(details, /Blue & white/); assert.match(details, /Two strobes\nSoftbox/);
  assert.match(details, /Name:\nClient/); assert.match(details, /Phone:\nPRIVATE_PHONE/); assert.match(details, /Email:\nPRIVATE_EMAIL/);
  assert.match(details, /Calendar:\nSmooth Studios/); assert.match(details, /Price:\n\$100/); assert.match(details, /Paid Online:\n\$100/);
  assert.match(details, /Studio Rental Form/); assert.doesNotMatch(details, /PRIVATE_ID|Accepted|https:|Booking link/);
  assert.equal(rentalDetails(undefined), '');
  assert.equal(rentalDetails('Backdrop colors:\nAcuityID=123'), 'Backdrop colors:\nNot provided');
});
test('reference-style rental forms retain the form name, shoot, backdrop and unanswered optional props', () => {
  const details = rentalDetails('Calendar: Smooth Studios\nName: Example Client\nPhone: 202-555-0100\nEmail: example@example.invalid\nPrice: $50.00\nPaid Online: $25.00\nStudio A Rental Form\n=======\nWhat type of photoshoot are you doing?: Creative Photoshoot\nWhat color backdrop do you need set up?: Red\nDo you need any props or accessories for your shoot? (Leave blank if you don’t):\nCancellation link: https://example.invalid/SECRET');
  for (const value of ['Name:\nExample Client', 'Phone:\n202-555-0100', 'Email:\nexample@example.invalid', 'Price:\n$50.00', 'Paid Online:\n$25.00', 'Studio A Rental Form', 'Creative Photoshoot', 'Red', 'Not provided']) assert.ok(details.includes(value), value);
  assert.doesNotMatch(details, /SECRET|Cancellation link/);
});
test('rental descriptions travel through sync only to the owner and assigned employees', async t => {
  const f = await fixture(); delete f.env.VAPID_JWK; t.after(() => f.close());
  const appointment = { id: 'description-rental', title: 'Studio Rental', customer: 'Synthetic client', start: '2026-10-20T12:00Z', end: '2026-10-20T13:00Z', priceCents: 10000, acceptedEmployeeIds: ['jordyn'], rentalDetails: rentalDetails(description) };
  assert.equal((await f.call('sync', '/sync/import', { generation: 'details-test', appointments: [appointment] })).status, 200);
  assert.equal((await f.call('sync', '/sync/commit', { generation: 'details-test', count: 1 })).status, 200);
  assert.equal((await f.call('owner', '/schedule')).data.appointments[0].rentalDetails, appointment.rentalDetails);
  assert.equal((await f.call('jordyn', '/schedule')).data.appointments[0].rentalDetails, appointment.rentalDetails);
  assert.equal((await f.call('rayne', '/schedule')).data.appointments.length, 0);
});
