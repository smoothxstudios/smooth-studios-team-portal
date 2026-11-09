import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/notification-fixture.mjs';
import { rentalPayAt, rentalPayInput } from '../lib/rental-pay-rates.mjs';
import { calculateEmployeePayout } from '../scripts/lib/employee-pay.mjs';
import { readRentalPayRates, syncRentalPayRates } from '../scripts/lib/rental-pay-rates.mjs';
import { buildDashboardPayloads } from '../scripts/lib/dashboard-data.mjs';

const baseline = { employeeId: 'dacari', compensation: { type: 'hourly', hourlyCents: 1500 } };
const seed = f => f.call('sync', '/sync/rental-pay-rates', { employees: [baseline] });
const input = (extra={}) => ({ id: crypto.randomUUID(), employeeId: 'dacari', revision: 0, compensation: { type: 'hourly', hourlyCents: 2000 }, ...extra });

test('rental rates are private to the owner and sync cannot make owner edits', async t => {
  const f=await fixture();t.after(f.close);
  assert.equal((await seed(f)).status,200);
  assert.equal((await f.call('sync','/sync/rental-pay-rates')).data.rates[0].compensation.hourlyCents,1500);
  for(const id of ['jordyn','dacari','rayne']) {
    assert.equal((await f.call(id,'/rental-pay-rates')).status,403);
    assert.equal((await f.call(id,'/rental-pay-rates',input(),'PUT')).status,403);
    assert.equal((await f.call(id,'/sync/rental-pay-rates',{employees:[baseline]})).status,403);
  }
  assert.equal((await f.call('sync','/rental-pay-rates',input(),'PUT')).status,403);
  assert.equal((await f.call('owner','/sync/rental-pay-rates',{employees:[baseline]})).status,403);
  assert.equal((await f.call('unknown','/rental-pay-rates')).status,401);
});

test('saved rates survive imports, reject stale edits, and replay without a second change', async t => {
  const f=await fixture();t.after(f.close);await seed(f);
  const change=input(), before=Date.now();
  const saved=await f.call('owner','/rental-pay-rates',change,'PUT');
  assert.equal(saved.status,200);assert.equal(saved.data.rate.revision,1);
  assert.ok(Date.parse(saved.data.rate.effectiveAt)>=before);
  assert.equal(saved.data.rate.history.length,1);
  assert.equal((await f.call('owner','/rental-pay-rates',change,'PUT')).data.duplicate,true);
  assert.equal((await f.call('owner','/rental-pay-rates',input(),'PUT')).status,409);
  assert.equal((await f.call('owner','/rental-pay-rates',{...change,compensation:{type:'commission',rate:.4}},'PUT')).status,409);
  await seed(f);
  let rate=(await f.call('owner','/rental-pay-rates')).data.rates[0];
  assert.equal(rate.compensation.hourlyCents,2000);assert.equal(rate.history.length,1);
  const next=await f.call('owner','/rental-pay-rates',input({revision:1,compensation:{type:'commission',rate:.35}}),'PUT');
  assert.equal(next.data.rate.history.length,2);assert.equal(next.data.rate.compensation.rate,.35);
  const unchanged=await f.call('owner','/rental-pay-rates',input({revision:2,compensation:{type:'commission',rate:.35}}),'PUT');
  assert.equal(unchanged.data.unchanged,true);assert.equal(unchanged.data.rate.revision,2);
});

test('concurrent saves cannot overwrite one another or duplicate a retried save', async t => {
  const f=await fixture();t.after(f.close);await seed(f);
  const change=input();
  const attempts=await Promise.all([f.call('owner','/rental-pay-rates',change,'PUT'),f.call('owner','/rental-pay-rates',change,'PUT')]);
  assert.ok(attempts.every(result=>result.status===200));
  assert.equal((await f.call('owner','/rental-pay-rates')).data.rates[0].history.length,1);
  const competing=await Promise.all([f.call('owner','/rental-pay-rates',input({revision:1,compensation:{type:'hourly',hourlyCents:2200}}),'PUT'),f.call('owner','/rental-pay-rates',input({revision:1,compensation:{type:'hourly',hourlyCents:2300}}),'PUT')]);
  assert.deepEqual(competing.map(result=>result.status).sort(),[200,409]);
  assert.equal((await f.call('owner','/rental-pay-rates')).data.rates[0].revision,2);
});

test('invalid rates and identities leave saved rates untouched', async t => {
  const f=await fixture();t.after(f.close);await seed(f);
  for(const compensation of [{type:'hourly',hourlyCents:0},{type:'hourly',hourlyCents:-100},{type:'hourly',hourlyCents:1500.5},{type:'hourly',hourlyCents:100001},{type:'commission',rate:0},{type:'commission',rate:1.1},{type:'commission',rate:.123456},{type:'pending'}]) {
    assert.equal((await f.call('owner','/rental-pay-rates',input({compensation}),'PUT')).status,400);
  }
  assert.equal((await f.call('owner','/rental-pay-rates',input({employeeId:'owner'}),'PUT')).status,400);
  assert.equal((await f.call('owner','/rental-pay-rates',input({revision:-1}),'PUT')).status,400);
  assert.equal((await f.call('owner','/rental-pay-rates')).data.rates[0].revision,0);
  for(const value of ['', '-5','1e2','15.555','NaN'])assert.throws(()=>rentalPayInput('hourly',value));
  assert.deepEqual(rentalPayInput('hourly','15.25'),{type:'hourly',hourlyCents:1525});
  assert.deepEqual(rentalPayInput('commission','33.33'),{type:'commission',rate:.3333});
});

test('new rates follow the exact rental start, preserve older paid earnings, and leave other work alone', () => {
  const config={timeZone:'America/New_York',commissionRate:.3};
  const employee={id:'person',compensation:{type:'hourly',hourlyCents:1500},rentalPayHistory:[
    {revision:1,effectiveAt:'2026-11-01T06:00:00Z',compensation:{type:'hourly',hourlyCents:2000}},
    {revision:2,effectiveAt:'2026-11-02T00:00:00Z',compensation:{type:'commission',rate:.25}},
  ]};
  const payout=(start,end,extra={})=>calculateEmployeePayout({employee,config,ledger:{employees:{person:{paidThrough:'2026-11-01'}}},start,end,priceCents:5000,categoryId:'studio-rentals',fullyPaid:true,now:Date.parse('2026-11-05'),...extra});
  assert.equal(payout('2026-11-01T05:00:00Z','2026-11-01T06:30:00Z').amountCents,2250);
  assert.equal(payout('2026-11-01T05:00:00Z','2026-11-01T06:30:00Z').paidAmountCents,2250);
  assert.equal(payout('2026-11-01T06:00:00Z','2026-11-01T07:30:00Z').amountCents,3000);
  assert.equal(payout('2026-11-02T14:00:00Z','2026-11-02T15:30:00Z').amountCents,1250);
  assert.equal(payout('2026-11-02T14:00:00Z','2026-11-02T15:30:00Z',{categoryId:'studio-packages'}).compensationConfigured,false);
  const commission={id:'person',commissionHistory:[{effectiveFrom:'2026-09-26',rate:.4}],rentalPayHistory:employee.rentalPayHistory};
  assert.equal(rentalPayAt(commission,config,'2026-09-26T03:59:00Z').rate,.3);
  assert.equal(rentalPayAt(commission,config,'2026-09-26T04:00:00Z').rate,.4);
  assert.equal(rentalPayAt(commission,config,'2026-11-02T14:00:00Z',false).rate,.4);
});

test('calendar and app acceptance use saved rate history without exposing another employee rate', () => {
  const employee={id:'dacari',name:'DaCari',email:'fixture@example.invalid',compensation:{type:'hourly',hourlyCents:1500},rentalPayHistory:[{revision:1,effectiveAt:'2026-11-01T00:00:00Z',compensation:{type:'hourly',hourlyCents:2200}}]};
  const config={studioName:'Fixture',timeZone:'America/New_York',commissionRate:.3,employees:[employee],owner:{id:'owner',name:'Owner'}};
  const event={id:'booking',summary:'Preview: Studio A Rental',start:{dateTime:'2026-11-02T10:00:00-05:00'},end:{dateTime:'2026-11-02T11:30:00-05:00'},description:'Price: $75.00\nPaid Online: $75.00',attendees:[{email:employee.email,responseStatus:'accepted'}]};
  const opts={config,ledger:{employees:{}},overrides:{},calendarEvents:[event]};
  const calendar=buildDashboardPayloads(opts);
  const portal=buildDashboardPayloads({...opts,calendarEvents:[{...event,attendees:[]}],portalAssignments:[{appointmentId:event.id,employeeId:'dacari',start:event.start.dateTime,end:event.end.dateTime}]});
  assert.equal(calendar.owner.rentals[0].employeePayouts.dacari.amountCents,3300);
  assert.equal(portal.dacari.rentals[0].employeePayouts.dacari.amountCents,3300);
  assert.equal(portal.owner.employees[0].compensation.hourlyCents,2200);
  assert.equal(JSON.stringify(portal.dacari).includes('rentalPayHistory'),false);
});

test('sync fails closed when live rates cannot be read and preserves legacy configuration', async () => {
  const config={commissionRate:.3,employees:[{id:'dacari',compensation:{type:'hourly',hourlyCents:1500}}]};
  const password='synthetic-owner-password-at-least-20-characters';
  await assert.rejects(syncRentalPayRates(config,password,async()=>Response.json({error:'unavailable'},{status:503})),/preserved/);
  await assert.rejects(syncRentalPayRates(config,password,async()=>Response.json({rates:[]})),/missing/);
  const result=await syncRentalPayRates(config,password,async()=>Response.json({rates:[{employeeId:'dacari',history:[{revision:1,effectiveAt:'2026-11-09T18:00:00Z',compensation:{type:'hourly',hourlyCents:2000}}]}]}));
  assert.equal(result[0].compensation.hourlyCents,1500);
  assert.equal(result[0].rentalPayHistory[0].compensation.hourlyCents,2000);
  await readRentalPayRates(config,password,async(_url,options)=>{
    assert.equal(options.method,'GET');assert.equal(options.body,undefined);
    return Response.json({rates:[{employeeId:'dacari',history:[]}]});
  });
});
