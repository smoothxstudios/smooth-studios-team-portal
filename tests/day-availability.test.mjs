import test from 'node:test';
import assert from 'node:assert/strict';
import { dayAvailability } from '../lib/day-availability.mjs';
const empty = { blocks: [], assignments: [], appointments: [], workPreferences: [] };
test('no recorded preference means available all day, including DST days', () => {
  for (const [day, hours] of [['2026-11-13',24],['2026-11-01',25],['2026-03-08',23]]) {
    const result = dayAvailability('jordyn',day,empty);
    assert.equal(result.status,'available');
    assert.equal(result.free.length,1);
    assert.equal((Date.parse(result.end)-Date.parse(result.start))/3600000,hours);
  }
});
test('merges overlapping blocks and pending work, leaving exact free hours', () => {
  const data={...empty,blocks:[{userId:'jordyn',reason:'Class',startLocal:'2026-11-13T12:00',endLocal:'2026-11-13T14:00'},{userId:'jordyn',startLocal:'2026-11-13T13:00',endLocal:'2026-11-13T15:00'}],assignments:[{employeeId:'jordyn',status:'pending',start:'2026-11-13T20:00:00Z',end:'2026-11-13T21:00:00Z'}]};
  const result=dayAvailability('jordyn','2026-11-13',data);
  assert.equal(result.status,'partial');
  assert.deepEqual(result.free,[{start:'2026-11-13T05:00:00.000Z',end:'2026-11-13T17:00:00.000Z'},{start:'2026-11-13T21:00:00.000Z',end:'2026-11-14T05:00:00.000Z'}]);
});
test('weekly overnight blocks, accepted rentals and pending calendar invitations reduce availability', () => {
  const data={...empty,blocks:[{userId:'jordyn',startLocal:'2026-11-05T23:00',endLocal:'2026-11-06T02:00',repeatUntil:'2026-11-30'}],appointments:[{id:'a',start:'2026-11-13T07:00:00Z',end:'2026-11-14T05:00:00Z',acceptedEmployeeIds:[],calendarInvitations:[{employeeId:'jordyn',status:'needsAction'}]}]};
  assert.equal(dayAvailability('jordyn','2026-11-13',data).status,'unavailable');
  data.appointments[0].acceptedEmployeeIds=['jordyn'];data.appointments[0].calendarInvitations=[];
  assert.equal(dayAvailability('jordyn','2026-11-13',data).status,'unavailable');
  assert.equal(dayAvailability('rayne','2026-11-13',data).status,'available');
});
test('declined and cancelled work does not block availability and preferences never restrict it',()=>{
  const data={...empty,assignments:['declined','cancelled'].map(status=>({employeeId:'jordyn',status,start:'2026-11-13T05:00:00Z',end:'2026-11-14T05:00:00Z'})),workPreferences:[{userId:'jordyn',startLocal:'2026-11-13T12:00',endLocal:'2026-11-13T14:00'}]};
  assert.equal(dayAvailability('jordyn','2026-11-13',data).status,'available');
});
