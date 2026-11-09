import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarTimeChange } from '../team-api/calendar-time-changes.mjs';
import { assignmentNotifications } from '../team-api/notification-content.mjs';
import { calendarRecord, calendarKey } from '../lib/sync-records.mjs';
import { syncRecords } from '../scripts/lib/incremental-sync.mjs';
import { fixture } from './helpers/notification-fixture.mjs';

const old = { id: 'same-day-accepted', appointmentId: 'same-day-rental', employeeId: 'akiva', title: 'Studio rental',
  start: '2026-10-17T17:00:00Z', end: '2026-10-17T18:00:00Z', status: 'accepted', instructions: 'Keep the setup',
  createdAt: '2026-10-16T15:00:00Z', updatedAt: '2026-10-16T16:00:00Z' };
const moved = { id: old.appointmentId, title: old.title, start: '2026-10-17T18:00:00.000Z', end: '2026-10-17T20:00:00.000Z',
  priceCents: 5000, acceptedEmployeeIds: [], calendarInvitations: [{employeeId: 'akiva', status: 'needsAction'}] };

test('same-day earlier and later starts preserve the saved response before, during and after work', () => {
  for (const now of ['2026-10-17T16:00:00Z', '2026-10-17T19:00:00Z', '2026-10-17T22:00:00Z']) {
    for (const status of ['accepted', 'pending']) {
      for (const start of ['2026-10-17T16:30:00Z', moved.start]) {
        const result = calendarTimeChange({...old, status, conflictOverride: {approvedBy:'owner'}}, {...moved, start}, Date.parse(now));
        assert.equal(result.event, 'same_day'); assert.equal(result.assignment.status, status);
        assert.equal(result.assignment.start, start); assert.equal(result.assignment.end, moved.end);
        assert.equal(result.assignment.id, old.id); assert.equal(result.assignment.instructions, old.instructions);
        assert.equal(result.assignment.createdAt, old.createdAt); assert.equal(result.assignment.conflictOverride, undefined);
        assert.equal(result.assignment.calendarChange.previousStart, old.start);
        const notices = assignmentNotifications(result.assignment, result.event, ['owner', 'akiva']);
        assert.ok(notices.every(n=>n.body.includes('same day')));
        assert.ok(notices.every(n=>n.body.includes(status==='accepted'?'acceptance is kept':'awaiting a response')));
        assert.ok(notices.every(n=>!/Tap to accept|new acceptance|cancelled/.test(n.body)));
      }
    }
  }
  for (const status of ['declined', 'cancelled']) assert.equal(calendarTimeChange({...old, status}, moved), null);
});

test('the studio date, not the UTC date or a rolling 24 hours, determines whether acceptance stays', () => {
  const cases = [
    ['2026-11-08T23:30:00Z', '2026-11-09T01:30:00Z', 'accepted'], // Different UTC dates, same studio day.
    ['2026-11-09T04:30:00Z', '2026-11-09T05:30:00Z', 'pending'], // Same UTC date, across studio midnight.
    ['2026-11-08T15:00:00Z', '2026-11-09T14:00:00Z', 'pending'], // Less than 24 hours, different date.
    ['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z', 'accepted'], // Repeated hour at fall-back.
    ['2026-03-08T06:30:00Z', '2026-03-08T07:30:00Z', 'accepted'], // Spring-forward.
    ['2026-12-31T23:30:00-05:00', '2027-01-01T00:30:00-05:00', 'pending'],
  ];
  for (const [start, next, expected] of cases) {
    const result=calendarTimeChange({...old,start}, {...moved,start:next,end:new Date(Date.parse(next)+3600000).toISOString()}, Date.parse('2026-01-01T00:00Z'));
    assert.equal(result.assignment.status,expected,`${start} -> ${next}`);
  }
});

for (const incremental of [false,true]) {
  for (const clock of ['2026-10-17T16:00:00Z','2026-10-17T22:00:00Z']) {
    test(`${incremental?'incremental':'full'} Calendar sync preserves accepted crew at ${clock} and clears them on another date`,async t=>{
      t.mock.method(Date,'now',()=>Date.parse(clock));
      const f=await fixture();delete f.env.VAPID_JWK;let sequence=0;
      const request=async(path,data)=>{const r=await f.call('sync',path,data);assert.equal(r.status,200,JSON.stringify(r));return r.data;};
      const publish=async event=>{
        const records=[calendarRecord(event)],calendarReadAt=new Date(Date.now()+ ++sequence).toISOString();
        if(incremental) await syncRecords({request,prefix:'/sync',records,key:calendarKey,field:'appointments',time:{calendarReadAt}});
        else {const generation=crypto.randomUUID();await request('/sync/import',{generation,appointments:records});await request('/sync/commit',{generation,count:1,calendarReadAt});}
        await Promise.allSettled(f.pending);
      };
      try {
        await publish({...moved,start:old.start,end:old.end});
        for(const [employeeId,status] of [['akiva','accepted'],['jordyn','accepted'],['rayne','pending']]){
          const a={...old,id:`same-day-${employeeId}`,employeeId,status};
          f.DB.sqlite.prepare('INSERT INTO team_assignments(id,employee_id,data) VALUES(?,?,?)').run(a.id,employeeId,JSON.stringify(a));
          f.DB.sqlite.prepare("INSERT INTO calendar_assignment_outbox(assignment_id,version,status,result,updated_at) VALUES(?,?,'stale','{}',?)").run(a.id,'old-version',Date.parse(old.updatedAt));
        }
        await publish(moved);
        const all=(await f.call('owner','/schedule')).data.assignments;
        assert.equal(all.length,3);
        for(const a of all){assert.equal(a.start,moved.start);assert.equal(a.end,moved.end);assert.equal(a.status,a.employeeId==='rayne'?'pending':'accepted');}
        const accepted=await request('/sync/accepted');
        assert.deepEqual(accepted.assignments.map(a=>a.employeeId).sort(),['akiva','jordyn']);
        assert.ok(accepted.assignments.every(a=>a.start===moved.start&&a.end===moved.end));
        assert.ok(f.DB.sqlite.prepare('SELECT version FROM calendar_assignment_outbox').all().every(r=>r.version!=='old-version'));
        if(Date.parse(clock)>Date.parse(moved.start)){
          const a=all.find(a=>a.employeeId==='akiva');
          assert.equal(a.calendarSync.googleStatus,'needsAction','app acceptance must not fabricate a Google RSVP');
          assert.equal(a.calendarSync.code,'calendar_imported');
        }
        const alerts=f.DB.sqlite.prepare('SELECT COUNT(*) n FROM team_inbox').get().n;
        assert.equal(alerts,6);
        await publish(moved);
        assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM team_inbox').get().n,alerts,'unchanged sync sends no duplicate alerts');
        await publish({...moved,start:'2026-10-18T18:00:00Z',end:'2026-10-18T20:00:00Z'});
        assert.equal((await request('/sync/accepted')).assignments.length,0);
        assert.ok((await f.call('owner','/schedule')).data.assignments.every(a=>a.status==='pending'));
      } finally {await Promise.allSettled(f.pending);f.close();}
    });
  }
}
