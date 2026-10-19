// Synthetic, local CPU benchmark of the pre-refactor planner calculation path
// versus the snapshot model. This does not measure network or full page loading.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { crewFit, plannerPeople, validatePlan, emptyPlan } from '../lib/event-planner.mjs';
import { createPlannerModel } from '../lib/event-planner-model.mjs';
import { TEAM, localInstant } from '../lib/team-schedule.mjs';

const day = '2026-10-23';
const plan = validatePlan({ ...emptyPlan(), events: Array.from({length:6}, (_, i) => ({
  id:`event-${i}`, title:`Synthetic event ${i}`, startLocal:`${day}T${String(9+i*2).padStart(2,'0')}:00`,
  endLocal:i===5?'2026-10-24T01:00':`${day}T${String(11+i*2).padStart(2,'0')}:00`,
  crewNeeded:3, people:[TEAM[i%TEAM.length].id,TEAM[(i+1)%TEAM.length].id],
})) });
const schedule = {appointments:[],assignments:[],blocks:[],workPreferences:[]};
for (const [i,person] of TEAM.entries()) {
  for (const date of ['2026-10-22',day,'2026-10-24']) {
    schedule.workPreferences.push({id:`pref-${person.id}-${date}`,userId:person.id,startLocal:`${date}T08:00`,endLocal:`${date}T23:00`});
    schedule.blocks.push({id:`block-${person.id}-${date}`,userId:person.id,startLocal:`${date}T${String(10+i).padStart(2,'0')}:00`,endLocal:`${date}T${String(11+i).padStart(2,'0')}:00`,reason:'Synthetic block'});
    schedule.appointments.push({id:`booking-${person.id}-${date}`,title:'Synthetic rental',customer:'Example',start:localInstant(`${date}T18:00`),end:localInstant(`${date}T19:00`),acceptedEmployeeIds:[person.id]});
    schedule.assignments.push({id:`task-${person.id}-${date}`,employeeId:person.id,status:'pending',title:'Synthetic task',start:localInstant(`${date}T15:00`),end:localInstant(`${date}T16:00`)});
  }
}
const order={available:0,flexible:1,check:2,unknown:3,blocked:4};
const queries=['','S','Sy','Syn','Synt'];
function previous(renders) {
  let calls=0,last;
  const fit=(id,event)=>{calls++;return crewFit(id,event,plan,schedule);};
  for(let render=0;render<renders;render++) {
    const conflicts=plan.events.filter(event=>event.people.some(id=>fit(id,event).status==='blocked')).length;
    const cards=plan.events.filter(event=>event.title.toLowerCase().includes(queries[render].toLowerCase())).map(event=>({
      id:event.id,
      options:plannerPeople(plan).map(p=>({...p,fit:fit(p.id,event)})).sort((a,b)=>order[a.fit.status]-order[b.fit.status]),
      selected:event.people.map(id=>fit(id,event)),
    }));
    last={conflicts,cards};
  }
  return {calls,last};
}
function refactored(renders) {
  const model=createPlannerModel(plan,schedule);let last;
  for(let render=0;render<renders;render++) {
    const view=model.forDay(day,queries[render]);
    last={conflicts:view.conflicts,cards:view.entries.filter(entry=>'event' in entry).map(({event})=>({
      id:event.id,options:model.optionsFor(event),selected:event.people.map(id=>model.fit(id,event)),
    }))};
  }
  return last;
}
for(const count of [1,5])assert.deepEqual(refactored(count),previous(count).last);
function median(samples){return samples.sort((a,b)=>a-b)[Math.floor(samples.length/2)];}
function measure(renders) {
  const before=[],after=[];
  for(let i=0;i<3;i++){previous(renders);refactored(renders);}
  for(let i=0;i<15;i++){
    for(const [operation,results] of i%2?[[refactored,after],[previous,before]]:[[previous,before],[refactored,after]]) {
      const start=performance.now();operation(renders);results.push(performance.now()-start);
    }
  }
  const beforeMs=median(before),afterMs=median(after);
  return {renders,beforeMs:+beforeMs.toFixed(3),afterMs:+afterMs.toFixed(3),lessTimePercent:+((1-afterMs/beforeMs)*100).toFixed(1),beforeEvaluations:previous(renders).calls,afterEvaluations:plan.events.length*TEAM.length};
}
console.log(JSON.stringify({scope:'Synthetic planner calculations; no network or DOM timing',events:plan.events.length,people:TEAM.length,blocks:schedule.blocks.length,appointments:schedule.appointments.length,timing:'15 alternating trials after 3 warmups; median milliseconds',cold:measure(1),fiveInteractions:measure(5)},null,2));
