import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/notification-fixture.mjs';
import { approvedAssignmentOverlap, unapprovedAssignmentConflicts, createConflictOverride, captureOverlapApprovals } from '../lib/assignment-conflict-review.mjs';
const a = { id:'A', employeeId:'rayne', appointmentId:'studio-a', title:'Studio A Rental', start:'2026-12-20T22:00:00Z', end:'2026-12-20T23:00:00Z', status:'accepted', createdAt:'2026-11-13T16:00:00Z', updatedAt:'2026-11-13T16:00:00Z' };
const b = { ...a,id:'B',appointmentId:'studio-b',title:'Studio B Rental',status:'pending' };
const approvedAt=Date.parse('2026-11-13T17:00:00Z');
const approved = (peers=[b]) => ({...a,conflictOverride:createConflictOverride(a,peers,approvedAt)});
const unresolved = (target,sources,blocks=[],appointments=[]) => unapprovedAssignmentConflicts('rayne',target,blocks,[target,...sources],appointments,target.id);

test('an approval covers both existing offers and their duplicate Calendar RSVP',()=>{
 const source=approved();
 assert.equal(approvedAssignmentOverlap(b,source),true);
 assert.deepEqual(unresolved(b,[source],[],[{...a,id:a.appointmentId,acceptedEmployeeIds:['rayne']}]),[]);
 assert.deepEqual(source.conflictOverride.relatedAssignments,[{id:b.id,start:b.start,end:b.end}]);
});

test('a legacy approval applies only to a peer proven unchanged when it was approved and survives its response',()=>{
 const source=approved();delete source.conflictOverride.relatedAssignments;
 assert.equal(approvedAssignmentOverlap(b,source),true);
 const accepted={...b,status:'accepted',updatedAt:'2026-11-13T18:00:00Z',overlapApprovals:captureOverlapApprovals(b,[source])};
 assert.equal(approvedAssignmentOverlap(accepted,source),true);
 assert.equal(approvedAssignmentOverlap({...b,updatedAt:'2026-11-13T18:00:00Z'},source),false);
 assert.equal(approvedAssignmentOverlap({...b,createdAt:'2026-11-13T18:00:00Z',updatedAt:'2026-11-13T18:00:00Z'},source),false);
 assert.equal(approvedAssignmentOverlap({...b,updatedAt:undefined},source),false);
});

test('approval never spreads to a third offer, another person, a blocked time, or an unrelated Calendar booking',()=>{
 const source=approved();
 assert.equal(approvedAssignmentOverlap({...b,id:'new-offer'},source),false);
 assert.equal(approvedAssignmentOverlap({...b,employeeId:'jordyn'},source),false);
 assert.equal(approvedAssignmentOverlap(b,approved([])),false);
 const c={...b,id:'C',appointmentId:'studio-c',title:'Other work'};
 assert.deepEqual(unresolved(b,[source,c]),['Assignment: Other work']);
 const block={userId:'rayne',reason:'Class',startLocal:'2026-12-20T17:00',endLocal:'2026-12-20T18:00'};
 assert.deepEqual(unresolved(b,[source],[block]),['Blocked: Class']);
 assert.deepEqual(unresolved(b,[source],[],[{...a,id:'unrelated',acceptedEmployeeIds:['rayne']}]),['Calendar: Studio A Rental']);
});

test('changing either rental time, removing the approved offer, or changing its approval invalidates the pair',()=>{
 const source=approved();
 for(const changed of [{...source,start:'2026-12-20T21:00:00Z'}, {...source,status:'cancelled'}, {...source,conflictOverride:undefined}]) assert.equal(approvedAssignmentOverlap(b,changed),false);
 assert.equal(approvedAssignmentOverlap({...b,end:'2026-12-21T00:00:00Z'},source),false);
 assert.equal(approvedAssignmentOverlap({...b,calendarChange:{changedAt:'2026-11-13T18:00:00Z'}},source),false,'moving away then back still needs review');
 const legacy=approved();delete legacy.conflictOverride.relatedAssignments;
 const accepted={...b,updatedAt:'2026-11-13T18:00:00Z',overlapApprovals:captureOverlapApprovals(b,[legacy])};
 assert.equal(approvedAssignmentOverlap(accepted,{...legacy,conflictOverride:{...legacy.conflictOverride,approvedAt:'2026-11-13T17:30:00Z'}}),false);
});

test('API accepts the pending side of a legacy approved overlap without changing the other acceptance',async()=>{
 const f=await fixture();delete f.env.VAPID_JWK;
 try{
  const start=new Date(Date.now()+86400000).toISOString(),end=new Date(Date.now()+90000000).toISOString();
  const created=new Date(Date.now()-10000).toISOString(),approvedTime=new Date(Date.now()-5000).toISOString();
  const source={...a,start,end,createdAt:created,updatedAt:approvedTime,conflictOverride:{approvedBy:'owner',approvedAt:approvedTime,start,end}};
  const target={...b,start,end,createdAt:created,updatedAt:created};
  const generation=crypto.randomUUID();
  const appointments=[source,target].map(item=>({id:item.appointmentId,title:item.title,start,end,priceCents:5000,customer:'',acceptedEmployeeIds:item===source?['rayne']:[]}));
  assert.equal((await f.call('sync','/sync/import',{generation,appointments})).status,200);
  assert.equal((await f.call('sync','/sync/commit',{generation,count:2})).status,200);
  for(const item of [source,target])f.DB.sqlite.prepare('INSERT INTO team_assignments(id,employee_id,data) VALUES(?,?,?)').run(item.id,item.employeeId,JSON.stringify(item));
  let schedule=(await f.call('rayne','/schedule')).data;
  assert.deepEqual(unapprovedAssignmentConflicts('rayne',target,schedule.blocks,schedule.assignments,schedule.appointments,target.id),[]);
  const response=await f.call('rayne','/assignments/B',{revision:schedule.revision,status:'accepted'});
  assert.equal(response.status,200,JSON.stringify(response.data));
  schedule=(await f.call('rayne','/schedule')).data;
  assert.equal(schedule.assignments.find(x=>x.id==='A').status,'accepted');
  const saved=schedule.assignments.find(x=>x.id==='B');assert.equal(saved.status,'accepted');
  assert.deepEqual(unapprovedAssignmentConflicts('rayne',saved,schedule.blocks,schedule.assignments,schedule.appointments,saved.id),[]);
  assert.equal(saved.overlapApprovals.length,1);
 }finally{await Promise.allSettled(f.pending);f.close()}
});
