import test from 'node:test';
import assert from 'node:assert/strict';
import { rentalTeamDescription } from '../scripts/lib/calendar-assignments.mjs';
import { fixture } from './helpers/notification-fixture.mjs';
import { buildScheduleAgenda } from '../lib/schedule-agenda.mjs';
import { assignmentResponseLabel } from '../lib/calendar-invitations.mjs';
import { calendarTimeChange } from '../team-api/calendar-time-changes.mjs';

const now = Date.parse('2030-11-08T21:00:00Z');
const rental = { id:'recorded-rental', title:'Studio rental', customer:'Test booking', start:'2030-11-08T18:00:00Z', end:'2030-11-08T19:00:00Z', priceCents:5000, acceptedEmployeeIds:[], calendarInvitations:[] };
async function setup(t, appointment = rental) {
  t.mock.method(Date,'now',()=>now);
  const f=await fixture(); delete f.env.VAPID_JWK;
  t.after(async()=>{await Promise.allSettled(f.pending); f.close();});
  const generation=crypto.randomUUID();
  assert.equal((await f.call('sync','/sync/import',{generation,appointments:[appointment]})).status,200);
  assert.equal((await f.call('sync','/sync/commit',{generation,count:1})).status,200);
  const schedule=async()=> (await f.call('owner','/schedule')).data;
  const record=async(extra={},user='owner')=>f.call(user,'/assignments',{
    revision:(await schedule()).revision,employeeId:'akiva',appointmentId:appointment.id,
    confirmWorked:true,confirmedStart:appointment.start,confirmedEnd:appointment.end,...extra,
  });
  return {...f,schedule,record};
}
function prior(f,status='cancelled') {
  const item={id:'previous-offer',employeeId:'akiva',appointmentId:rental.id,title:rental.title,instructions:'Saved arrival note',start:rental.start,end:rental.end,status,createdAt:'2030-11-07T18:00:00Z',updatedAt:'2030-11-07T19:00:00Z'};
  f.DB.sqlite.prepare('INSERT INTO team_assignments(id,employee_id,data) VALUES(?,?,?)').run(item.id,item.employeeId,JSON.stringify(item));
  return item;
}

test('owner can record completed rental work while preserving prior cancellation and normal earnings export',async t=>{
  const f=await setup(t), old=prior(f);
  assert.equal((await f.schedule()).appointments[0].cancelled,true);
  const result=await f.record();assert.equal(result.status,200,JSON.stringify(result));
  assert.match(result.data.notification,/no payment was recorded/);
  const s=await f.schedule(), saved=s.assignments.find(a=>a.id!==old.id);
  assert.deepEqual(s.assignments.find(a=>a.id===old.id),old);
  assert.equal(saved.status,'accepted');assert.equal(saved.ownerConfirmation.confirmedBy,'owner');
  assert.equal(s.appointments[0].cancelled,false);
  assert.deepEqual((await f.call('sync','/sync/accepted')).data.assignments,[{appointmentId:rental.id,employeeId:'akiva',start:new Date(rental.start).toISOString(),end:new Date(rental.end).toISOString()}]);
  const exported=(await f.call('sync','/sync/accepted')).data.calendarAssignments;
  assert.match(rentalTeamDescription('',exported),/Confirmed by Smooth/);
  assert.doesNotMatch(rentalTeamDescription('',exported),/Accepted in app/);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM calendar_assignment_outbox').get().n,0);
  const entry=buildScheduleAgenda(s,{from:'2030-11-08T00:00:00Z',to:'2030-11-09T00:00:00Z'}).find(a=>a.kind==='work');
  assert.deepEqual(entry.confirmedIds,['akiva']);assert.equal(assignmentResponseLabel(entry.confirmations[0]),'Confirmed by Smooth');
  const employee=(await f.call('akiva','/schedule')).data;assert.equal(employee.assignments.find(a=>a.id===saved.id).ownerConfirmation.confirmedBy,'owner');
  assert.equal(employee.appointments.length,1);
  const alerts=f.DB.sqlite.prepare('SELECT title,body FROM team_inbox').all();
  assert.equal(alerts.length,1);assert.match(alerts[0].title,/confirmed by Smooth/);assert.doesNotMatch(alerts[0].body,/Tap to accept|accepted a rental/);
  assert.equal((await f.record()).status,409,'retry must not duplicate work');
  assert.equal((await f.schedule()).assignments.length,2);
});

test('recording an expired pending offer confirms it once and retires its old delivery job',async t=>{
  const f=await setup(t),old=prior(f,'pending');
  f.DB.sqlite.prepare("INSERT INTO calendar_assignment_outbox(assignment_id,version,status,result,updated_at) VALUES(?,?,'pending','{}',?)").run(old.id,'old',now-3600000);
  assert.equal((await f.record()).status,200);
  const s=await f.schedule(); assert.equal(s.assignments.length,1);
  assert.equal(s.assignments[0].id,old.id);assert.equal(s.assignments[0].createdAt,old.createdAt);assert.equal(s.assignments[0].instructions,old.instructions);
  assert.equal(s.assignments[0].calendarSync,undefined);
  assert.equal(f.DB.sqlite.prepare('SELECT status FROM calendar_assignment_outbox').get().status,'stale');
});

test('started rental requires explicit owner confirmation of the exact current times',async t=>{
  const f=await setup(t,{...rental,end:'2030-11-08T22:00:00Z'});
  for(const extra of [{confirmWorked:undefined},{confirmWorked:false},{confirmWorked:'true'},{confirmedStart:undefined},{confirmedEnd:rental.end}]){
    const r=await f.record(extra);assert.ok([400,409].includes(r.status),JSON.stringify(r));
  }
  assert.equal((await f.record({},'akiva')).status,403);
  assert.equal((await f.record({revision:-1})).status,409);
  assert.equal((await f.schedule()).assignments.length,0);
  assert.equal((await f.record()).status,200);
});

test('upcoming rentals still need employee acceptance and custom work cannot bypass the future-date rule',async t=>{
  const a={...rental,start:'2030-11-09T18:00:00Z',end:'2030-11-09T19:00:00Z'},f=await setup(t,a);
  assert.equal((await f.record()).status,400);
  assert.equal((await f.record({appointmentId:'',title:'Custom work',startLocal:'2030-11-07T12:00',endLocal:'2030-11-07T13:00'})).status,400);
  assert.equal((await f.record({confirmWorked:false})).status,200);
  assert.equal((await f.schedule()).assignments[0].status,'pending');
  assert.equal((await f.schedule()).assignments[0].ownerConfirmation,undefined);
  assert.equal((await f.call('sync','/sync/accepted')).data.assignments.length,0);
});

test('historical confirmation retains conflict and fresh-calendar safeguards',async t=>{
  const f=await setup(t);
  const conflict={...prior(f,'accepted'),id:'another-work',appointmentId:null};
  f.DB.sqlite.prepare('DELETE FROM team_assignments').run();
  f.DB.sqlite.prepare('INSERT INTO team_assignments(id,employee_id,data) VALUES(?,?,?)').run(conflict.id,conflict.employeeId,JSON.stringify(conflict));
  assert.equal((await f.record()).status,409);
  assert.equal((await f.record({overrideConflicts:true})).status,200);
  assert.equal((await f.schedule()).assignments.find(a=>a.appointmentId)?.conflictOverride.approvedBy,'owner');
  f.DB.sqlite.prepare('UPDATE team_state SET synced_at=?').run('2030-11-08T12:00:00Z');
  assert.equal((await f.record({employeeId:'jordyn'})).status,409);
});

test('same-day edits keep owner confirmation; moving to another date clears it',()=>{
  const item={...rental,appointmentId:rental.id,status:'accepted',ownerConfirmation:{confirmedBy:'owner',confirmedAt:'2030-11-08T21:00:00Z'}};
  const sameDay=calendarTimeChange(item,{...rental,start:'2030-11-08T19:00:00Z',end:'2030-11-08T20:00:00Z'},now);
  assert.deepEqual(sameDay.assignment.ownerConfirmation,item.ownerConfirmation);assert.match(sameDay.assignment.note,/Smooth’s work confirmation/);
  const nextDay=calendarTimeChange(item,{...rental,start:'2030-11-09T19:00:00Z',end:'2030-11-09T20:00:00Z'},now);
  assert.equal(nextDay.assignment.status,'pending');assert.equal(nextDay.assignment.ownerConfirmation,undefined);
});
