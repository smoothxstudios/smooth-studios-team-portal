import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/notification-fixture.mjs';
import { studioLocal } from '../lib/team-schedule.mjs';
import { applyRentalAdvances, scopedPayroll } from '../lib/payroll-advances.mjs';
import { creativeOwed } from '../lib/creative-work.mjs';
import { appointmentCancelled } from '../lib/appointment-lifecycle.mjs';
import { buildDashboardPayloads } from '../scripts/lib/dashboard-data.mjs';

const past=new Date(Date.now()-86400000).toISOString(),through=studioLocal(Date.now()).slice(0,10);
async function setup(){const f=await fixture();delete f.env.VAPID_JWK;return f;}
async function sync(f, entries){const generation=crypto.randomUUID(),asOf=new Date().toISOString();
  assert.equal((await f.call('sync','/sync/payroll/import',{generation,asOf,earnings:entries})).status,200);
  const result=await f.call('sync','/sync/payroll/commit',{generation,asOf,count:entries.length});assert.equal(result.status,200,JSON.stringify(result));return result.data;}
const earning=(id,amount,paid=0,employeeId='rayne')=>({employeeId,rentalId:id,amountCents:amount,paidCents:paid,earnedAt:past,eligible:true});
async function manual(f,amount){const r=await f.call('owner','/creative-work/manual-pay',{id:crypto.randomUUID(),employeeId:'rayne',category:'training',workDate:through,amountCents:amount,paymentStatus:'owed',note:''});assert.equal(r.status,200);return r.data.assignment;}
async function preview(f,id='rayne'){const r=await f.call('owner',`/payroll/payments/preview?employee=${id}&through=${through}`);assert.equal(r.status,200,JSON.stringify(r));return r.data;}
const input=p=>({id:crypto.randomUUID(),employeeId:p.employeeId,through:p.through,revision:p.revision,reviewKey:p.reviewKey,cashCents:p.cashCents,method:'Synthetic',note:''});
function rentalCharge(f,amount,paid=0,id='own-studio'){
  const a={id,title:'Studio A Rental',customer:'Synthetic renter',teamRenterId:'rayne',priceCents:amount,paidOnlineCents:paid,fullyPaid:paid>=amount,start:new Date(Date.parse(past)-3600000).toISOString(),end:past,acceptedEmployeeIds:[]};
  f.DB.sqlite.prepare('INSERT INTO team_appointments(generation,id,data) VALUES (?,?,?)').run('',id,JSON.stringify(a));return a;
}
test('one payment settles appointment and added pay, verifies zero, and stale payloads use live paid amounts',async()=>{
  const f=await setup();await sync(f,[earning('shift',1500),earning('other',2000,0,'jordyn')]);const added=await manual(f,2500);
  const p=await preview(f);assert.equal(p.cashCents,4000);assert.equal(p.items.length,2);
  const request=input(p),r=await f.call('owner','/payroll/payments',request);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.receipt.remainingPayableCents,0);
  const state=(await f.call('rayne','/payroll')).data;assert.equal(state.accounts[0].payableCents,0);
  const adjusted=applyRentalAdvances([{id:'shift',employeePayouts:{rayne:{amountCents:1500,paid:false}}}],state);assert.equal(adjusted[0].employeePayouts.rayne.outstandingCents,0);
  assert.equal(creativeOwed((await f.call('rayne','/creative-work')).data.assignments.find(i=>i.id===added.id)),0);
  assert.equal((await f.call('owner','/payroll/payments',request)).data.duplicate,true);
  assert.equal((await f.call('owner','/payroll/payments',{...request,cashCents:999})).status,409);
  assert.equal((await f.call('jordyn','/payroll')).data.accounts[0].payableCents,2000);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM payroll_receipts').get().n,1);
});
test('already-marked rentals stay paid while training is included, and later earnings are not silently covered by a cutoff',async()=>{
  const f=await setup();await sync(f,[earning('already-paid',1500,1500)]);await manual(f,3000);
  const p=await preview(f);assert.equal(p.cashCents,3000);assert.equal(p.items[0].kind,'creative');
  assert.equal((await f.call('owner','/payroll/payments',input(p))).status,200);
  await manual(f,800);assert.equal((await preview(f)).cashCents,800);
});
test('own rentals deduct only unpaid price, offset cash once, and preserve a carried balance',async()=>{
  const f=await setup();await sync(f,[earning('shift',6000)]);rentalCharge(f,10000,2500);
  let p=await preview(f);assert.equal(p.grossCents,6000);assert.equal(p.deductionCents,6000);assert.equal(p.cashCents,0);assert.equal(p.carryForwardCents,1500);
  assert.equal((await f.call('owner','/payroll/payments',input(p))).status,200);
  const state=(await f.call('rayne','/payroll')).data;assert.equal(state.accounts[0].carryForwardCents,1500);assert.equal(state.rentalCharges[0].appliedCents,6000);
  await manual(f,2500);p=await preview(f);assert.equal(p.deductionCents,1500);assert.equal(p.cashCents,1000);
  assert.equal((await f.call('owner','/payroll/payments',input(p))).status,200);
  assert.equal((await f.call('rayne','/payroll')).data.accounts[0].netCents,0);
  assert.equal((await preview(f)).grossCents,0);
});
test('one person cannot see another account, record payments, or replay a stale review',async()=>{
  const f=await setup();await sync(f,[earning('shift',6000)]);const p=await preview(f);await manual(f,500);
  assert.equal((await f.call('owner','/payroll/payments',input(p))).status,409);
  assert.equal((await f.call('rayne','/payroll/payments',input(p))).status,403);
  assert.equal((await f.call('sync','/payroll/payments',input(p))).status,403);
  rentalCharge(f,3000);const state=(await f.call('owner','/payroll')).data;
  const scoped=scopedPayroll(state,'jordyn');assert.deepEqual(scoped.rentalCharges,[]);assert.deepEqual(scoped.earnings,[]);assert.deepEqual(scoped.rentalPayments,[]);
  const other=(await f.call('jordyn','/payroll')).data;assert.deepEqual(other.rentalCharges,[]);assert.deepEqual(other.paymentReceipts,[]);
});
test('parallel payment submissions cannot pay the same earnings twice',async()=>{
  const f=await setup();await sync(f,[earning('shift',1500)]);await manual(f,2500);const p=await preview(f),request=input(p);
  const replies=await Promise.all([f.call('owner','/payroll/payments',request),f.call('owner','/payroll/payments',request)]);
  assert.ok(replies.every(r=>r.status===200||r.status===409),JSON.stringify(replies));
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM payroll_receipts').get().n,1);
  assert.equal((await preview(f)).grossCents,0);
});
test('unapproved completed appointments cancel, accepted and team rentals remain valid',()=>{
  const a={id:'x',start:'2026-11-01T04:00:00Z',end:'2026-11-01T07:00:00Z',acceptedEmployeeIds:[]};const now=Date.parse('2026-11-01T08:00Z');
  assert.equal(appointmentCancelled(a,[],now),true);
  assert.equal(appointmentCancelled(a,[],Date.parse('2026-11-01T06:00Z')),false);
  assert.equal(appointmentCancelled({...a,acceptedEmployeeIds:['rayne']},[],now),false);
  assert.equal(appointmentCancelled({...a,teamRenterId:'rayne'},[],now),false);
  assert.equal(appointmentCancelled({...a,ownerAccepted:true},[],now),false);
  assert.equal(appointmentCancelled(a,[{appointmentId:'x',status:'accepted',start:a.start,end:a.end}],now),false);
  assert.equal(appointmentCancelled(a,[{appointmentId:'x',status:'pending',start:a.start,end:a.end}],now),true);
});
test('booking email identifies the renter exactly, hides other payroll, and gives no commission for their own rental',()=>{
  const config={timeZone:'America/New_York',importStart:'2026-01-01T00:00:00Z',commissionRate:.3,owner:{name:'Studio'},employees:[{id:'rayne',name:'Rayne',email:'rayne@example.invalid'},{id:'jordyn',name:'Jordyn',email:'j@example.invalid'}]};
  const event={id:'own',summary:'Synthetic: Studio A Rental',description:'Email: RAYNE@example.invalid\nPrice: $100\nPaid Online: $25',start:{dateTime:'2026-10-01T14:00:00Z'},end:{dateTime:'2026-10-01T15:00:00Z'},attendees:[{email:'rayne@example.invalid',responseStatus:'accepted'}]};
  const p=buildDashboardPayloads({calendarEvents:[event],config,ledger:{employees:{}},overrides:{events:{}},source:'sample'});
  assert.equal(p.owner.rentals[0].teamRenterId,'rayne');assert.equal(p.owner.rentals[0].cancelled,false);assert.deepEqual(p.owner.rentals[0].employeePayouts,{});
  assert.deepEqual(p.rayne.rentals[0].employeePayouts,{});assert.equal(p.jordyn.rentals.length,0);
  const unknown=buildDashboardPayloads({calendarEvents:[{...event,description:'Name: Rayne\nEmail: unknown@example.invalid\nPrice: $100'}],config,ledger:{employees:{}},overrides:{events:{}},source:'sample'});
  assert.equal(unknown.owner.rentals[0].teamRenterId,undefined);
});
