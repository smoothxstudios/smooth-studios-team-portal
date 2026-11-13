import test from 'node:test';
import assert from 'node:assert/strict';
import { rentalSuggestions } from '../lib/rental-suggestions.mjs';
const period={id:'rental',start:'2026-11-02T18:00:00Z',end:'2026-11-02T19:00:00Z',acceptedEmployeeIds:[]};
const schedule={activeEmployeeIds:['akiva','rayne','jordyn'],blocks:[],assignments:[],appointments:[],workPreferences:[{userId:'rayne',startLocal:'2026-11-02T12:00',endLocal:'2026-11-02T15:00'}]};
test('suggestions prioritize full preferences and assume unblocked staff are available',()=>{
 const rows=rentalSuggestions(period,schedule);assert.equal(rows[0].id,'rayne');assert.match(rows.find(p=>p.id==='akiva').reason,/Available/);assert.ok(!rows.some(p=>p.id==='owner'));
});
test('blocks, booked work, pending offers, and Calendar invitations exclude suggestions',()=>{
 const data={...schedule,blocks:[{userId:'rayne',startLocal:'2026-11-02T13:00',endLocal:'2026-11-02T14:00'}],assignments:[{employeeId:'akiva',appointmentId:'rental',status:'pending',...period}],appointments:[]};
 assert.deepEqual(rentalSuggestions({...period,calendarInvitations:[{employeeId:'jordyn',status:'needsAction'}]},data),[]);
});

test('seasonal accounts are omitted even with preferred hours and remain in the roster', async () => {
 const { TEAM } = await import('../lib/team-schedule.mjs');
 const data={...schedule,activeEmployeeIds:['carlos','armani','jordyn'],workPreferences:[{userId:'armani',startLocal:'2026-11-02T12:00',endLocal:'2026-11-02T15:00'}]};
 assert.deepEqual(rentalSuggestions(period,data).map(p=>p.id),['jordyn']);
 assert.ok(['carlos','armani'].every(id=>TEAM.some(p=>p.id===id&&p.seasonal)));
 assert.ok(rentalSuggestions(period,{...data,activeEmployeeIds:undefined}).every(p=>!['carlos','armani'].includes(p.id)));
});

test('suggestions stay within noon–10 PM Eastern, with inclusive opening and closing', () => {
 for (const [start,end,expected] of [
 ['2026-11-13T14:00:00Z','2026-11-13T15:00:00Z',false],
 ['2026-11-13T16:59:00Z','2026-11-13T18:00:00Z',false],
 ['2026-11-13T17:00:00Z','2026-11-14T03:00:00Z',true],
 ['2026-11-14T02:00:00Z','2026-11-14T03:01:00Z',false],
 ['2026-11-14T04:00:00Z','2026-11-14T18:00:00Z',false],
 ['2026-03-08T16:00:00Z','2026-03-09T02:00:00Z',true],
 ]) assert.equal(rentalSuggestions({...period,start,end},schedule).length>0,expected);
});
