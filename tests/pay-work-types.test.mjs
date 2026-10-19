import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/notification-fixture.mjs';
import { advanceCorrectionChecks } from '../lib/advance-correction.mjs';

async function setup(t) { const f=await fixture();delete f.env.VAPID_JWK;t.after(()=>f.close());return f; }
const path='/creative-work/work-types';
test('only the owner can create and list work types; saving options has no payroll or alert effects',async t=>{
  const f=await setup(t);
  for(const user of ['jordyn','rayne','sync']) {
    assert.equal((await f.call(user,path)).status,403);
    assert.equal((await f.call(user,path,{label:'Synthetic event coverage'})).status,403);
  }
  const result=await f.call('owner',path,{label:'Synthetic event coverage'});assert.equal(result.status,200);
  const options=(await f.call('owner',path)).data.options;
  assert.equal(options.length,4);assert.ok(options.some(o=>o.id===result.data.option.id));
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM team_creative_assignments').get().n,0);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM team_notification_events').get().n,0);
});
test('repeated or concurrent option names select one saved type and built-ins stay unique',async t=>{
  const f=await setup(t);
  const results=await Promise.all([' Event  Coverage ','event coverage'].map(label=>f.call('owner',path,{label})));
  assert.ok(results.every(r=>r.status===200));assert.equal(results[0].data.option.id,results[1].data.option.id);
  assert.equal((await f.call('owner',path,{label:' TRAINING '})).data.option.id,'training');
  for(const label of ['', '  ', 'a'.repeat(61), null]) assert.equal((await f.call('owner',path,{label})).status,400);
  assert.equal((await f.call('owner',path)).data.options.length,4);
});
test('custom work types are accepted by Add pay and store their exact saved name',async t=>{
  const f=await setup(t),option=(await f.call('owner',path,{label:'Synthetic coverage'})).data.option;
  const input={id:crypto.randomUUID(),employeeId:'jordyn',category:option.id,title:'Forged label',workDate:'2025-09-12',amountCents:5000,paymentStatus:'owed'};
  const result=await f.call('owner','/creative-work/manual-pay',input);
  assert.equal(result.status,200);assert.equal(result.data.assignment.title,option.label);assert.equal(result.data.assignment.workCategory,option.id);
  assert.equal((await f.call('owner','/creative-work/manual-pay',input)).data.duplicate,true);
  assert.equal((await f.call('owner','/creative-work/manual-pay',{...input,id:crypto.randomUUID(),category:'made-up'})).status,400);
});
test('advance correction separates incomplete time, unpaid customer and missing compensation',()=>{
  const review={kind:'rental',employeeId:'akiva'},rental={end:'2025-01-01T00:00:00Z',fullyPaid:false,employeePayouts:{akiva:{compensationConfigured:true}}};
  assert.deepEqual(advanceCorrectionChecks(review,rental,Date.parse('2026-01-01')).map(c=>c.ok),[true,false,true]);
  assert.deepEqual(advanceCorrectionChecks(review,{...rental,fullyPaid:true,employeePayouts:{}},Date.parse('2024-01-01')).map(c=>c.ok),[false,true,false]);
  assert.deepEqual(advanceCorrectionChecks(review,undefined),[]);
});
