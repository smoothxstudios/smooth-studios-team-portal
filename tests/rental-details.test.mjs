import assert from 'node:assert/strict';
import test from 'node:test';
import { rentalDetails } from '../lib/rental-details.mjs';
import { fixture } from './helpers/notification-fixture.mjs';
const description = `[Smooth Studios rental team]\nAkiva — Accepted\n[/Smooth Studios rental team]\nCalendar: Smooth Studios\nName: Client\nPhone: PRIVATE_PHONE\nEmail: PRIVATE_EMAIL\nPrice: $100\nPaid Online: $100\nStudio Rental Form\n====\nWhat type of photoshoot are you doing?:\nBirthday portraits\nBackdrop colors: Blue &amp; white\nEquipment needed:\nTwo strobes\nSoftbox\nEmail: PRIVATE_EMAIL\nBooking link: https://example.invalid/private\nAcuityID=PRIVATE_ID`;
test('operational booking answers preserve paragraphs and strip administrative fields, links and team notes', () => {
  const details = rentalDetails(description);
  assert.match(details, /Birthday portraits/); assert.match(details, /Blue & white/); assert.match(details, /Two strobes\nSoftbox/);
  assert.doesNotMatch(details, /PRIVATE|Accepted|Calendar|Price|https:/);
  assert.equal(rentalDetails(undefined), ''); assert.equal(rentalDetails('Name: Client\nBackdrop colors:\nAcuityID=123'), '');
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
