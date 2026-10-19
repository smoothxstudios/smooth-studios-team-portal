import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlannerModel } from '../lib/event-planner-model.mjs';
import { emptyPlan, validatePlan, crewFit } from '../lib/event-planner.mjs';

const event = {id:'night', title:'Night event', startLocal:'2026-10-23T22:00', endLocal:'2026-10-24T02:00', crewNeeded:2, people:['owner']};
const plan = validatePlan({...emptyPlan(), events:[event]});
const schedule = {appointments:[], assignments:[], blocks:[], workPreferences:[]};

test('cached evaluations match the rules and refresh when coverage or source data changes', () => {
  const model = createPlannerModel(plan, schedule), e = plan.events[0];
  for (const person of model.people) assert.deepEqual(model.fit(person.id,e),crewFit(person.id,e,plan,schedule));
  const options = model.optionsFor(e);
  assert.strictEqual(model.optionsFor({...e,notes:'Edited',crewNeeded:5,people:[]}),options);
  const shorter = {...e,coverageEndLocal:'2026-10-23T23:00'};
  assert.notStrictEqual(model.optionsFor(shorter),options);
  assert.deepEqual(model.fit('owner',shorter),crewFit('owner',shorter,plan,schedule));
  const updated = {...schedule, blocks:[{id:'new',userId:'owner',startLocal:e.startLocal,endLocal:e.endLocal,reason:'Busy'}]};
  assert.equal(createPlannerModel(plan,updated).fit('owner',e).status,'blocked');
  const changedPlan = {...plan,events:[e,{...e,id:'overlap',people:['owner']} ]};
  assert.equal(createPlannerModel(changedPlan,schedule).fit('owner',e).status,'blocked');
});

test('day grouping, search, archive filtering and summary counts retain their meanings', () => {
  const p = validatePlan({...plan,events:[event,{...event,id:'archive',title:'Archived',archived:true}]});
  const model=createPlannerModel(p,{...schedule,appointments:[{id:'booking',title:'Rental',customer:'Example',start:'2026-10-24T02:00:00Z',end:'2026-10-24T06:00:00Z'}]});
  assert.equal(model.dayCounts.get('2026-10-23'),1);
  assert.equal(model.forDay('2026-10-24').entries.length,0);
  assert.equal(model.forDay('2026-10-23').entries.length,2);
  assert.equal(model.forDay('2026-10-23','',false,true).entries.length,3);
  const searched=model.forDay('2026-10-23','EXAMPLE');
  assert.equal(searched.entries.length,1);assert.equal(searched.appointments.length,1);
  assert.equal(searched.dayEvents.length,1);assert.equal(searched.unfilled,1);
  assert.equal(model.forDay('2026-10-23','Night',true).entries.length,1);
});
