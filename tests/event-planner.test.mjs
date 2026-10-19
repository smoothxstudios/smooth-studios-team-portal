import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/notification-fixture.mjs';
import { emptyPlan, validatePlan, mergePlan, crewFit, plannerOnDay } from '../lib/event-planner.mjs';
import { localInstant } from '../lib/team-schedule.mjs';

const event = extra => ({ id:'event-one', title:'Synthetic event', startLocal:'2026-10-23T22:00', endLocal:'2026-10-24T02:00', crewNeeded:2, people:[], ...extra });
const available = (personId, startLocal='2026-10-23T00:00',endLocal='2026-10-24T00:00') => ({ id:`available-${personId}`, personId, startLocal, endLocal, status:'available', note:'' });
const plan = extra => validatePlan({...emptyPlan(), events:[event()],...extra});
async function setup(t) { const f = await fixture(); t.after(()=>f.close()); return f; }
const save = (f, p, revision=0) => f.call('owner','/event-planner',{...p,revision},'PUT');

test('overnight blocks are enforced and shorter coverage can fit before midnight', () => {
  const p=plan({availability:[available('rayne')]}), e=p.events[0];
  const schedule={blocks:[{id:'block',userId:'rayne',startLocal:'2026-10-24T00:00',endLocal:'2026-10-25T00:00',reason:'Unavailable Saturday'}]};
  assert.equal(crewFit('rayne',e,p,schedule).status,'blocked');
  assert.equal(crewFit('rayne',{...e,coverageEndLocal:'2026-10-24T00:00'},p,schedule).status,'available');
  assert.equal(plannerOnDay(e,'2026-10-23'),true);
  assert.equal(plannerOnDay(e,'2026-10-24'),true);
  assert.equal(plannerOnDay({...e,endLocal:'2026-10-24T00:00'},'2026-10-24'),false);
});

test('unknown hours, missing end times, partial and tentative availability are honest', () => {
  const p=plan({availability:[available('akiva')]});
  assert.equal(crewFit('jordyn',p.events[0],p,{}).status,'unknown');
  assert.equal(crewFit('akiva',p.events[0],p,{}).status,'check');
  const noEnd={...p.events[0],endLocal:''};
  assert.equal(crewFit('akiva',noEnd,p,{}).status,'check');
  assert.equal(crewFit('akiva',noEnd,p,{}).availableAtStart,true);
  p.availability.push({...available('jordyn'),status:'tentative'});
  assert.equal(crewFit('jordyn',noEnd,p,{}).status,'check');
});

test('accepted rentals, pending offers and overlapping event plans block double booking', () => {
  const p=plan({availability:[available('akiva','2026-10-23T00:00','2026-10-25T00:00')]});
  const e=p.events[0], time={start:localInstant(e.startLocal),end:localInstant(e.endLocal)};
  for(const status of ['pending','accepted']) assert.equal(crewFit('akiva',e,p,{assignments:[{id:'offer',employeeId:'akiva',status,title:'Studio offer',...time}]}).status,'blocked');
  assert.equal(crewFit('akiva',e,p,{appointments:[{id:'booking',title:'Rental',acceptedEmployeeIds:['akiva'],...time}]}).status,'blocked');
  p.events[0].people=['akiva'];
  assert.equal(crewFit('akiva',e,p,{}).status,'available','an event does not conflict with itself');
  p.events.push({...e,id:'second',title:'Other event',people:['akiva']});
  assert.equal(crewFit('akiva',e,p,{}).status,'blocked');
  p.events[1].archived=true;
  assert.equal(crewFit('akiva',e,p,{}).status,'available');
});

test('imports preserve existing crew choices, support guests and validate malformed plans', () => {
  const incoming=plan({guests:[{id:'guest-one',name:'Guest One'}]});
  const current=structuredClone(incoming);current.events[0].people=['guest-one'];
  assert.deepEqual(mergePlan(current,incoming),current);
  for(const edit of [ {crewNeeded:-1}, {crewNeeded:1.5}, {crewNeeded:"3"}, {crewNeeded:Number.MAX_SAFE_INTEGER+1}, {people:['akiva','akiva']}, {people:['missing']}, {endLocal:'2026-10-22T22:00'}, {startLocal:'2026-02-30T22:00'} ]) assert.throws(()=>plan({events:[event(edit)]}));
  assert.throws(()=>plan({guests:[{id:'owner',name:'Guest'}]}));
});

test('planner is owner-only, persists without sending offers and rejects stale saves',async t=>{
  const f=await setup(t),p=plan();
  for(const user of ['akiva','jordyn','sync']) {
    assert.equal((await f.call(user,'/event-planner')).status,403);
    assert.equal((await f.call(user,'/event-planner',{...p,revision:0},'PUT')).status,403);
  }
  const results=await Promise.all([save(f,p),save(f,p)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const read=await f.call('owner','/event-planner');assert.equal(read.data.revision,1);assert.deepEqual(read.data.events,p.events);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM team_notification_events').get().n,0);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM team_assignments').get().n,0);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM payroll_advance_allocations').get().n,0);
});

test('server rejects newly conflicting crew but retains existing plans for review after availability changes',async t=>{
  const f=await setup(t),p=plan();p.events[0].people=['akiva'];
  assert.equal((await save(f,p)).status,200);
  const block={id:'block',userId:'akiva',startLocal:'2026-10-23T20:00',endLocal:'2026-10-24T03:00',reason:'New block'};
  f.DB.sqlite.prepare('INSERT INTO team_blocks(id,user_id,data) VALUES(?,?,?)').run(block.id,block.userId,JSON.stringify(block));
  p.events[0].notes='Keep the event while reviewing the new conflict';
  assert.equal((await save(f,p,1)).status,200);
  p.events[0].coverageStartLocal='2026-10-23T21:00';
  assert.equal((await save(f,p,2)).status,409);
  p.events[0].people=[];
  assert.equal((await save(f,p,2)).status,200);
});


test('dashboard browser preflight permits planner saves only for trusted origins', async () => {
  const { default: worker } = await import('../team-api/worker.mjs');
  for (const origin of ['https://dashboard.smoothstudios.co', 'https://untrusted.example']) {
    const response = await worker.fetch(new Request('https://api.example.invalid/event-planner', {method:'OPTIONS', headers:{origin,'access-control-request-method':'PUT','access-control-request-headers':'authorization,content-type'}}), {}, {});
    if (origin.includes('untrusted')) assert.equal(response.status,403);
    else { assert.equal(response.status,204);assert.equal(response.headers.get('access-control-allow-origin'),origin);assert.ok(response.headers.get('access-control-allow-methods').split(', ').includes('PUT')); }
  }
});

test('custom crew sizes support more than two people and persist through the API', async t => {
  const f=await setup(t),p=plan({events:[event({crewNeeded:5,people:['owner','akiva','jordyn']})]});
  assert.equal((await save(f,p)).status,200);
  const saved=(await f.call('owner','/event-planner')).data.events[0];
  assert.equal(saved.crewNeeded,5);assert.deepEqual(saved.people,['owner','akiva','jordyn']);
  assert.throws(()=>plan({events:[event({crewNeeded:2,people:saved.people})]}));
  assert.equal((await save(f,{...p,events:[{...saved,crewNeeded:1.5}]},1)).status,400);
});
