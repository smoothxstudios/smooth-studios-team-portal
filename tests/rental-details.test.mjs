import assert from 'node:assert/strict';
import test from 'node:test';
import { rentalDetails } from '../lib/rental-details.mjs';
import { fixture } from './helpers/notification-fixture.mjs';
const description = `[Smooth Studios rental team]\nAkiva — Accepted\n[/Smooth Studios rental team]\nCalendar: Smooth Studios\nName: Client\nPhone: PRIVATE_PHONE\nEmail: PRIVATE_EMAIL\nPrice: $100\nPaid Online: $100\nStudio Rental Form\n====\nWhat type of photoshoot are you doing?:\nBirthday portraits\nBackdrop colors: Blue &amp; white\nEquipment needed:\nTwo strobes\nSoftbox\nEmail: PRIVATE_EMAIL\nBooking link: https://example.invalid/private\nAcuityID=PRIVATE_ID`;
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
