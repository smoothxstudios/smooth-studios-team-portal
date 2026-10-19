import assert from "node:assert/strict";
import test from "node:test";
import { fixture, device } from "./helpers/notification-fixture.mjs";
import { rentalBalanceCandidates, sendRentalBalanceReminders } from "../team-api/rental-balance-reminders.mjs";

const baseline = Date.parse("2026-10-19T18:00:00Z");
const iso = ms => new Date(ms).toISOString();
const booking = (extras = {}) => ({
  id: "synthetic-studio-rental", title: "Studio A Rental", customer: "Synthetic Client",
  start: iso(baseline - 50 * 60_000), end: iso(baseline + 10 * 60_000),
  priceCents: 5000, paidOnlineCents: 2000, fullyPaid: false,
  acceptedEmployeeIds: ["jordyn", "rayne"], ...extras,
});

test("reminders require a recent recorded outstanding amount and the final ten minutes", () => {
  const rental = booking();
  const candidates = rentalBalanceCandidates([rental], [], iso(baseline), baseline);
  assert.deepEqual(candidates.map(c => c.employeeId), ["jordyn", "rayne"]);
  assert.ok(candidates.every(c => c.payload.body.includes("$30.00")));
  assert.equal(rentalBalanceCandidates([{...rental, fullyPaid: true}], [], iso(baseline), baseline).length, 0);
  assert.equal(rentalBalanceCandidates([{...rental, paidOnlineCents: null}], [], iso(baseline), baseline).length, 0);
  assert.equal(rentalBalanceCandidates([{...rental, paidOnlineCents: 5000}], [], iso(baseline), baseline).length, 0);
  assert.equal(rentalBalanceCandidates([rental], [], iso(baseline - 13 * 60_000), baseline).length, 0);
  assert.equal(rentalBalanceCandidates([rental], [], iso(baseline), baseline - 60_000).length, 0);
  assert.equal(rentalBalanceCandidates([rental], [], iso(baseline), baseline + 10 * 60_000).length, 0);
  assert.equal(rentalBalanceCandidates([{...rental, title: "Wedding Video"}], [], iso(baseline), baseline).length, 0);
});

test("unaccepted and removed people are excluded; accepted app offers are included", () => {
  const rental = booking({acceptedEmployeeIds:["jordyn"]});
  const accepted = {id:"accepted", appointmentId:rental.id, start:rental.start, end:rental.end, employeeId:"amia", status:"accepted"};
  const pending = {id:"pending", appointmentId:rental.id, start:rental.start, end:rental.end, employeeId:"terrill", status:"pending"};
  assert.deepEqual(rentalBalanceCandidates([rental],[accepted,pending],iso(baseline),baseline).map(x=>x.employeeId),["jordyn","amia"]);
  const removed = {id:"removed",appointmentId:rental.id,start:rental.start,end:rental.end,
    employeeId:"jordyn",status:"cancelled",removeCalendarGuest:true,createdAt:iso(baseline-10000)};
  assert.deepEqual(rentalBalanceCandidates([rental],[removed,pending],iso(baseline),baseline),[]);
});

test("one durable checkout reminder is saved and pushed per assigned person across repeated cron checks", async t => {
  const f = await fixture(); t.after(() => f.close());
  t.mock.method(Date, "now", () => baseline);
  const generation = crypto.randomUUID(), rental = booking();
  const imported = await f.call("sync","/sync/import",{generation,appointments:[rental]});
  assert.equal(imported.status,200,JSON.stringify(imported));
  const committed = await f.call("sync","/sync/commit",{generation,count:1,calendarReadAt:iso(baseline)});
  assert.equal(committed.status,200,JSON.stringify(committed));
  const d=device("rental-due"); await f.call("jordyn","/push/device",d);
  let sent = 0;
  const send = async (url,options) => {
    assert.equal(url,d.endpoint); const payload=d.decrypt(options.body);
    assert.equal(payload.title,"Rental balance reminder");
    assert.match(payload.body,/\$30\.00/); sent++;
    return new Response(null,{status:201});
  };
  assert.equal((await sendRentalBalanceReminders(f.env,send,baseline)).queued,2);
  assert.equal(sent,1);
  assert.equal((await sendRentalBalanceReminders(f.env,send,baseline+60_000)).queued,0);
  assert.equal(sent,1);
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) n FROM team_inbox WHERE title='Rental balance reminder'").get().n,2);
  assert.equal(f.DB.sqlite.prepare("SELECT expires_at FROM team_inbox WHERE user_id='jordyn' AND title='Rental balance reminder'").get().expires_at,Date.parse(rental.end));
});
