import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/notification-fixture.mjs';
import { applyRentalAdvance, applyRentalAdvances, scopedPayroll } from '../lib/payroll-advances.mjs';
import { creativeOwed, creativePaid } from '../lib/creative-work.mjs';

const keys = await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'}, true, ['encrypt','decrypt']);
const privateKey = JSON.stringify(await crypto.subtle.exportKey('jwk', keys.privateKey));
const b64 = bytes => Buffer.from(bytes).toString('base64url');
async function encrypted(amountCents, employeeId='jordyn', id=crypto.randomUUID()) {
  const key = await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  return { id, iv:b64(iv), wrappedKey:b64(await crypto.subtle.encrypt('RSA-OAEP',keys.publicKey,await crypto.subtle.exportKey('raw',key))),
    ciphertext:b64(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(`smooth-payroll-advance:v1:${id}`)},key,new TextEncoder().encode(JSON.stringify({employeeId,amountCents,basis:'unpaid-and-future'})))) };
}
async function setup() { const f=await fixture();delete f.env.VAPID_JWK;f.env.STUDIO_REFERENCE_KEY=privateKey;f.sequence=0;return f; }
const earning=(rentalId,amountCents,paidCents=0,extra={})=>({rentalId,employeeId:'jordyn',amountCents,paidCents,earnedAt:new Date(Date.now()-86400_000).toISOString(),eligible:true,...extra});
async function sync(f,earnings) {
  const generation=crypto.randomUUID(),asOf=new Date(Date.now()+(++f.sequence)).toISOString();
  assert.equal((await f.call('sync','/sync/payroll/import',{generation,asOf,earnings})).status,200);
  const result=await f.call('sync','/sync/payroll/commit',{generation,asOf,count:earnings.length});assert.equal(result.status,200);return result.data;
}
async function advance(f,amount,employee='jordyn') {const envelope=await encrypted(amount,employee);const r=await f.call('sync','/sync/payroll/advances',envelope);assert.equal(r.status,200);return {state:r.data,envelope};}
const balance=(state,id='jordyn')=>state.balances.find(b=>b.employeeId===id);
const credit=(state,id,kind='rental')=>state.allocations.find(a=>a.sourceId===id&&a.kind===kind);

test('advance consumes only unpaid earned work, preserves prior cash, and clears automatically',async()=>{
  const f=await setup();
  const entries=[earning('paid',3000,3000),earning('partial',3000,1000),earning('unpaid',4000),earning('future',5000,0,{eligible:false,earnedAt:new Date(Date.now()+86400_000).toISOString()}),earning('deposit',2000,0,{eligible:false}),earning('other',3000,0,{employeeId:'rayne'})];
  await sync(f,entries);const {state}=await advance(f,10000);
  assert.equal(balance(state).appliedCents,6000);assert.equal(balance(state).remainingCents,4000);
  assert.equal(credit(state,'paid'),undefined);assert.equal(credit(state,'future'),undefined);assert.equal(credit(state,'deposit'),undefined);assert.equal(credit(state,'other'),undefined);
  const paid=applyRentalAdvance({amountCents:3000,paidAmountCents:1000,paid:false},credit(state,'partial'));
  assert.equal(paid.cashPaidCents,1000);assert.equal(paid.advanceAppliedCents,2000);assert.equal(paid.outstandingCents,0);
  // The final earning is larger than the remaining credit: the excess is owed.
  entries[3]=earning('future',5000);const next=await sync(f,entries);
  assert.equal(balance(next).remainingCents,0);assert.equal(credit(next,'future').amountCents,4000);
  assert.equal(applyRentalAdvance({amountCents:5000,paid:false},credit(next,'future')).outstandingCents,1000);
  const again=await sync(f,entries);assert.equal(balance(again).appliedCents,10000);
});

test('paid-through markers and retrospective rate changes do not deduct or pay the advance twice',async()=>{
  const f=await setup();await sync(f,[earning('part',3000,1500)]);const {state}=await advance(f,1000);
  let payout=applyRentalAdvance({amountCents:3000,paidAmountCents:1500,paid:false},credit(state,'part'));
  assert.equal(payout.paidAmountCents,2500);assert.equal(payout.outstandingCents,500);
  const next=await sync(f,[earning('part',3000,3000)]);
  payout=applyRentalAdvance({amountCents:3000,paidAmountCents:3000,paid:true},credit(next,'part'));
  assert.equal(payout.cashPaidCents,2000);assert.equal(payout.paidAmountCents,3000);assert.equal(balance(next).appliedCents,1000);
  assert.deepEqual(applyRentalAdvance(payout,credit(next,'part')),payout);
  // A later pay increase can consume only remaining advance, not prior credit.
  await advance(f,2000);const raised=await sync(f,[earning('part',4000,3000)]);
  assert.equal(balance(raised).appliedCents,2000);assert.equal(balance(raised).remainingCents,1000);
  const current=applyRentalAdvance({amountCents:4000,paidAmountCents:3000,paid:false},credit(raised,'part'));
  assert.equal(current.cashPaidCents,2000);assert.equal(current.paidAmountCents,4000);
});

function seedCreative(f,id,amountCents,status='approved',payments=[]) {
  const now=new Date().toISOString();const item={id,employeeId:'jordyn',version:1,title:'Synthetic edit',instructions:'Synthetic instructions',references:[],amountCents,status,createdAt:now,updatedAt:now,approvedAt:status==='approved'?now:null,dueAt:now,submissions:[],payments,history:[]};
  f.DB.sqlite.prepare('INSERT INTO team_creative_assignments(id,employee_id,version,mutation,data) VALUES (?,?,?,?,?)').run(id,'jordyn',1,crypto.randomUUID(),JSON.stringify(item));return item;
}
test('rental and creative earnings share one balance and approved work is credited immediately',async()=>{
  const f=await setup();await sync(f,[earning('rental',2500)]);
  const old=seedCreative(f,crypto.randomUUID(),3500,'approved',[{id:'cash',amountCents:500,paidAt:new Date().toISOString(),method:'synthetic'}]);
  const submitted=seedCreative(f,crypto.randomUUID(),4000,'submitted');
  const {state}=await advance(f,8000);
  assert.equal(balance(state).appliedCents,5500);assert.equal(credit(state,submitted.id,'creative'),undefined);
  const list=await f.call('jordyn','/creative-work');const item=list.data.assignments.find(i=>i.id===old.id);assert.equal(creativePaid(item),3500);assert.equal(creativeOwed(item),0);
  const result=await f.call('owner',`/creative-work/${submitted.id}`,{action:'approve',version:1},'PATCH');assert.equal(result.status,200);
  assert.equal(result.data.assignment.advanceAppliedCents,2500);assert.equal(creativeOwed(result.data.assignment),1500);
  assert.equal((await f.call('owner',`/creative-work/${submitted.id}`,{action:'pay',version:2,amountCents:2000},'PATCH')).status,400);
  const paid=await f.call('owner',`/creative-work/${submitted.id}`,{action:'pay',version:2,amountCents:1500},'PATCH');assert.equal(paid.status,200);assert.equal(creativeOwed(paid.data.assignment),0);
  assert.equal(balance((await f.call('owner','/payroll')).data).remainingCents,0);
});

test('concurrent retries are idempotent, scoped to the employee, and reject tampered imports',async()=>{
  const f=await setup();await sync(f,[earning('a',4000),earning('b',4000)]);
  const envelope=await encrypted(5000);const results=await Promise.all(Array.from({length:6},()=>f.call('sync','/sync/payroll/advances',envelope)));
  assert.ok(results.every(r=>r.status===200));
  const snapshots=await Promise.all(Array.from({length:6},()=>f.call('jordyn','/payroll')));
  assert.ok(snapshots.every(r=>balance(r.data).appliedCents===5000));assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM payroll_advances').get().n,1);
  assert.deepEqual((await f.call('rayne','/payroll')).data.balances,[]);assert.deepEqual((await f.call('rayne','/payroll')).data.allocations,[]);
  assert.equal((await f.call('owner','/sync/payroll/advances',envelope)).status,403);assert.equal((await f.call('sync','/payroll')).status,403);
  assert.equal((await f.call('sync','/sync/payroll/advances',{...envelope,id:crypto.randomUUID()})).status,400);
  assert.equal((await f.call('sync','/sync/payroll/advances',await encrypted(6000,'jordyn',envelope.id))).status,409);
  const full=(await f.call('owner','/payroll')).data;
  assert.deepEqual(scopedPayroll(full,'rayne').allocations,[]);
  assert.equal(applyRentalAdvances([{id:'a',employeePayouts:{jordyn:{amountCents:4000,paid:false}}}],full)[0].employeePayouts.jordyn.outstandingCents,0);
});

test('a simultaneous cash payout and advance never overpay creative work',async()=>{
  const f=await setup();await sync(f,[]);const item=seedCreative(f,crypto.randomUUID(),5000);const envelope=await encrypted(4000);
  await Promise.all([f.call('sync','/sync/payroll/advances',envelope),f.call('owner',`/creative-work/${item.id}`,{action:'pay',version:1,amountCents:5000},'PATCH')]);
  const current=(await f.call('owner','/creative-work')).data.assignments[0];
  assert.ok(current.payments.reduce((n,p)=>n+p.amountCents,0)+current.advanceAppliedCents<=5000);
  assert.ok(creativeOwed(current)>=0);
});

test('changed or missing source earnings preserve consumed credit and flag review',async()=>{
  const f=await setup();await sync(f,[earning('a',5000)]);await advance(f,3000);
  const changed=await sync(f,[]);assert.equal(balance(changed).appliedCents,3000);assert.equal(changed.reviewCount,1);
  const restored=await sync(f,[earning('a',5000)]);assert.equal(balance(restored).appliedCents,3000);assert.equal(restored.reviewCount,0);
});
