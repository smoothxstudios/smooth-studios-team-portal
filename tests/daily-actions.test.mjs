import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerDailyWork, creativeNextActions, appointmentBalance} from '../lib/daily-actions.mjs';
import {actionFocusedHomeOrder} from '../lib/dashboard-layout.mjs';
const now=Date.parse('2026-10-20T14:00:00Z');
const rental={id:'today',title:'Studio A Rental',customer:'Synthetic client',start:'2026-10-20T16:00:00Z',end:'2026-10-20T17:00:00Z',priceCents:10000,paidOnlineCents:2500,fullyPaid:false,acceptedEmployeeIds:[]};
const offer={id:'offer',appointmentId:rental.id,employeeId:'jordyn',title:rental.title,start:rental.start,end:rental.end,status:'pending'};
test('daily work uses studio day and keeps pending app responses beside Calendar acceptance',()=>{
 const schedule={appointments:[{...rental,acceptedEmployeeIds:['jordyn']},{...rental,id:'tomorrow',start:'2026-10-21T16:00:00Z',end:'2026-10-21T17:00:00Z'},{...rental,id:'previous-evening',start:'2026-10-20T01:00:00Z',end:'2026-10-20T02:00:00Z'}],assignments:[offer],blocks:[]};
 const result=ownerDailyWork(schedule,now);
 assert.deepEqual(result.today.map(item=>item.appointment.id),['today']);
 assert.deepEqual(result.pending.map(item=>item.appointment.id),['today']);
 assert.deepEqual(result.unassigned.map(item=>item.appointment.id),['tomorrow']);
 assert.equal(ownerDailyWork({...schedule,assignments:[{...offer,status:'cancelled'}]},now).pending.length,0);
});
test('Home surfaces work needing a decision and actionable employee work in order',()=>{
 const rows=['approved','accepted','submitted','offered','revision','cancelled'].map((status,i)=>({id:status,status,dueAt:`2026-10-${21+i}T12:00:00Z`}));
 assert.deepEqual(creativeNextActions(rows,true).map(x=>x.id),['submitted','offered']);
 assert.deepEqual(creativeNextActions(rows,false).map(x=>x.id),['offered','revision','accepted']);
});
test('unknown and contradicted payments never become an invented balance',()=>{
 assert.deepEqual(appointmentBalance(rental),{label:'Balance remaining',remaining:7500});
 assert.equal(appointmentBalance({...rental,fullyPaid:true}).remaining,0);
 assert.equal(appointmentBalance({...rental,paidOnlineCents:null}).remaining,null);
 assert.equal(appointmentBalance({...rental,paidOnlineCents:12000}).remaining,null);
});
test('old default moves reports below work and preserves a custom Home order',()=>{
 assert.deepEqual(actionFocusedHomeOrder(['upcoming','attention','finances','hours','creative','reports']),['upcoming','attention','creative','hours','finances','reports']);
 const custom=['hours','upcoming','attention','creative','reports','finances'];assert.deepEqual(actionFocusedHomeOrder(custom),custom);
});
