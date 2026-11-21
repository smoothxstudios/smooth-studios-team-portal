import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture } from './helpers/notification-fixture.mjs';
import { rentalSuggestions } from '../lib/rental-suggestions.mjs';
import { studioTaskPay } from '../lib/studio-tasks.mjs';
import { localInstant } from '../lib/team-schedule.mjs';
import { alertCategory } from '../lib/alert-presentation.mjs';

const now = Date.parse('2026-11-16T16:00:00Z');
async function setup(t) {
  t.mock.timers.enable({ apis: ['Date'], now });
  const f = await fixture();
  t.after(async () => { await Promise.allSettled(f.pending); f.close(); });
  const generation = crypto.randomUUID();
  await f.call('sync', '/sync/import', { generation, appointments: [] });
  await f.call('sync', '/sync/commit', { generation, count: 0 });
  return f;
}
const schedule = async f => (await f.call('owner', '/schedule')).data;
async function create(f, overrides = {}) {
  const data = { id: crypto.randomUUID(), employeeId: 'jordyn', workType: 'studio-task', appointmentId: '',
    title: 'Organize equipment', instructions: 'Clean stands and organize the cable shelf.',
    startLocal: '2026-11-16T12:00', endLocal: '2026-11-16T14:30', taskPay: { type: 'hourly', rateCents: 1500 },
    revision: (await schedule(f)).revision, ...overrides };
  return { request: data, result: await f.call('owner', '/assignments', data) };
}

test('roster defaults hide the three paused members, preserve authentication and reject employee or stale writes', async t => {
  const f = await setup(t);
  const members = (await f.call('owner', '/team-roster')).data.members;
  assert.deepEqual(members.filter(p => !p.active).map(p => p.id).sort(), ['akiva', 'armani', 'carlos']);
  assert.equal((await f.call('akiva', '/identity')).status, 200);
  assert.equal((await f.call('jordyn', '/team-roster', { id: 'akiva', active: true, revision: 1 }, 'PUT')).status, 403);
  assert.equal((await f.call('owner', '/team-roster', { id: 'owner', active: false, revision: 0 }, 'PUT')).status, 400);
  assert.equal((await f.call('owner', '/team-roster', { id: 'akiva', active: true, revision: 1 }, 'PUT')).status, 200);
  assert.equal((await f.call('owner', '/team-roster', { id: 'akiva', active: false, revision: 1 }, 'PUT')).status, 409);
  assert.equal((await f.call('owner', '/team-roster')).data.members.find(p => p.id === 'akiva').active, true);
});

test('inactive people leave staffing suggestions while their assignments and payroll remain intact', async t => {
  const f = await setup(t);
  const { result } = await create(f);
  assert.equal(result.status, 200);
  const before = await schedule(f);
  assert.equal((await f.call('owner', '/team-roster', { id: 'jordyn', active: false, revision: 0 }, 'PUT')).status, 200);
  const after = await schedule(f);
  assert.deepEqual(after.assignments, before.assignments);
  assert.equal((await f.call('jordyn', '/schedule')).data.assignments.length, 1);
  const people = rentalSuggestions({ start: localInstant('2026-11-17T12:00'), end: localInstant('2026-11-17T13:00') }, after);
  assert.ok(!people.some(p => ['akiva', 'armani', 'carlos', 'jordyn'].includes(p.id)));
});

test('studio shifts save agreed hourly pay, appear privately in schedules and retry without duplicate offers', async t => {
  const f = await setup(t);
  const { request, result } = await create(f);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const s = await schedule(f), item = s.assignments[0];
  assert.equal(item.appointmentId, null);
  assert.match(result.data.notification, /^Shift saved/);
  assert.deepEqual(item.taskPay, { type: 'hourly', rateCents: 1500, amountCents: 3750 });
  assert.equal((await f.call('rayne', '/schedule')).data.assignments.length, 0);
  const alert = (await f.call('jordyn', '/alerts')).data.alerts[0];
  assert.equal(alert.title, 'New shift');
  assert.equal(alert.kind, 'shift');
  assert.equal(alert.targetId, item.id);
  assert.equal(alertCategory(alert).label, 'Shift');
  assert.equal((await f.call('owner', '/assignments', request)).status, 200);
  assert.equal((await schedule(f)).assignments.length, 1);
  assert.equal((await f.call('owner', '/assignments', { ...request, taskPay: { type: 'flat', rateCents: 9999 } })).status, 409);
  assert.equal((await f.call('jordyn', `/assignments/${item.id}`, { revision: s.revision, status: 'accepted' })).status, 200);
  assert.equal((await f.call('jordyn', '/creative-work')).data.assignments.length, 0);
});

test('a shift response reminder stays labeled as a shift and links to the same scheduled work', async t => {
  const f = await setup(t);
  const { request, result } = await create(f);
  assert.equal(result.status, 200);
  const reminder = await f.call('owner', `/assignments/${request.id}/remind`, { id: crypto.randomUUID() });
  assert.equal(reminder.status, 200, JSON.stringify(reminder.data));
  const alerts = (await f.call('jordyn', '/alerts')).data.alerts;
  const alert = alerts.find(item => item.title === 'Shift response reminder');
  assert.ok(alert);
  assert.equal(alertCategory(alert).label, 'Shift');
  assert.equal(alert.targetId, request.id);
  assert.match(alert.body, /accept or decline this shift/);
});

test('invalid pay, rental linkage, stale revisions and overlapping shifts cannot silently create new tasks', async t => {
  const f = await setup(t);
  assert.equal((await create(f, { taskPay: { type: 'hourly', rateCents: 0 } })).result.status, 400);
  assert.equal((await create(f, { endLocal: '2026-11-16T11:00' })).result.status, 400);
  assert.equal((await create(f, { instructions: '' })).result.status, 400);
  assert.equal((await create(f, { revision: -1 })).result.status, 409);
  assert.equal((await create(f)).result.status, 200);
  assert.equal((await create(f)).result.status, 409);
  assert.equal((await create(f, { overrideConflicts: true })).result.status, 200);
});

test('completed shifts add exactly one earning, including concurrent and lost-response retries, without recording payment', async t => {
  const f = await setup(t);
  const { request, result } = await create(f);
  assert.equal(result.status, 200);
  let revision = (await schedule(f)).revision;
  const path = `/assignments/${request.id}`, input = { revision, action: 'complete-task', confirmCompleted: true };
  assert.equal((await f.call('owner', path, input)).status, 409);
  assert.equal((await f.call('jordyn', path, input)).status, 403);
  t.mock.timers.setTime(Date.parse('2026-11-16T20:00:00Z'));
  assert.equal((await f.call('owner', path, { ...input, confirmCompleted: false })).status, 409);
  const results = await Promise.all([f.call('owner', path, input), f.call('owner', path, input)]);
  assert.ok(results.some(r => r.status === 200));
  assert.ok(results.every(r => [200, 409].includes(r.status)));
  assert.equal((await f.call('owner', path, input)).status, 200);
  const earnings = (await f.call('jordyn', '/creative-work')).data.assignments;
  assert.equal(earnings.length, 1);
  assert.equal(earnings[0].amountCents, 3750);
  assert.equal(earnings[0].status, 'approved');
  assert.deepEqual(earnings[0].payments, []);
  assert.equal((await f.call('rayne', '/creative-work')).data.assignments.length, 0);
  const account = (await f.call('owner', '/payroll')).data.accounts.find(p => p.employeeId === 'jordyn');
  assert.equal(account.payableCents, 3750);
  assert.ok((await schedule(f)).assignments[0].completedAt);
});

test('cancelled studio work creates no earnings and can be closed after a missed shift', async t => {
  const f = await setup(t);
  const { request } = await create(f);
  t.mock.timers.setTime(Date.parse('2026-11-16T20:00:00Z'));
  assert.equal((await f.call('owner', `/assignments/${request.id}`, { revision: (await schedule(f)).revision, status: 'cancelled' })).status, 200);
  assert.equal((await f.call('owner', `/assignments/${request.id}`, { revision: (await schedule(f)).revision, action: 'complete-task', confirmCompleted: true })).status, 409);
  assert.deepEqual((await f.call('jordyn', '/creative-work')).data.assignments, []);
});

test('hourly totals use actual Eastern duration across daylight saving and flat pay remains fixed', () => {
  const start = localInstant('2026-11-01T00:30'), end = localInstant('2026-11-01T02:30');
  assert.equal(studioTaskPay({ type: 'hourly', rateCents: 1500 }, start, end).amountCents, 4500);
  assert.equal(studioTaskPay({ type: 'flat', rateCents: 4000 }, start, end).amountCents, 4000);
  assert.throws(() => localInstant('2027-03-14T02:30'));
});

const pastShift = () => ({ startLocal: '2026-11-15T12:00', endLocal: '2026-11-15T14:00', confirmWorked: true, confirmCompleted: true,
  confirmedStart: localInstant('2026-11-15T12:00'), confirmedEnd: localInstant('2026-11-15T14:00') });
test('past shifts require exact owner confirmation, then atomically record one earning and completion alert', async t => {
  const f = await setup(t);
  for (const change of [{confirmWorked:false},{confirmCompleted:false},{confirmedEnd:localInstant('2026-11-15T15:00')},{revision:-1}]) {
    assert.ok([400,409].includes((await create(f,{...pastShift(),...change})).result.status));
  }
  assert.equal((await schedule(f)).assignments.length,0);
  const {request,result}=await create(f,pastShift());
  assert.equal(result.status,200,JSON.stringify(result.data));
  const item=(await schedule(f)).assignments[0];
  assert.equal(item.status,'accepted'); assert.equal(item.ownerConfirmation.confirmedBy,'owner'); assert.ok(item.completedAt);
  const earnings=(await f.call('jordyn','/creative-work')).data.assignments;
  assert.equal(earnings.length,1); assert.equal(earnings[0].amountCents,3000); assert.equal(earnings[0].earnedAt,request.confirmedEnd); assert.deepEqual(earnings[0].payments,[]);
  assert.equal((await f.call('rayne','/creative-work')).data.assignments.length,0);
  const alerts=(await f.call('jordyn','/alerts')).data.alerts;
  assert.equal(alerts.filter(a=>a.title==='Shift completed').length,1); assert.ok(!alerts.some(a=>a.title==='New shift'));
  assert.equal((await f.call('jordyn','/assignments',request)).status,403);
  assert.equal((await f.call('owner','/assignments',request)).status,200);
  assert.equal((await f.call('owner',`/assignments/${request.id}`,{action:'complete-task',confirmCompleted:true})).status,200);
  assert.equal((await f.call('jordyn','/creative-work')).data.assignments.length,1);
  assert.equal((await f.call('owner','/assignments',{...request,title:'Changed work'})).status,409);
});
test('concurrent past-shift retries cannot duplicate earnings and overlap still needs approval', async t=>{
  const f=await setup(t), request={id:crypto.randomUUID(),employeeId:'jordyn',workType:'studio-task',title:'Past task',instructions:'Completed setup',taskPay:{type:'flat',rateCents:4500},revision:(await schedule(f)).revision,...pastShift()};
  const results=await Promise.all([f.call('owner','/assignments',request),f.call('owner','/assignments',request)]);
  assert.ok(results.some(r=>r.status===200)); assert.ok(results.every(r=>[200,409].includes(r.status)));
  assert.equal((await f.call('owner','/assignments',request)).status,200);
  assert.equal((await f.call('jordyn','/creative-work')).data.assignments.length,1);
  assert.equal((await create(f,pastShift())).result.status,409);
  assert.equal((await create(f,{...pastShift(),overrideConflicts:true})).result.status,200);
});
test('in-progress shifts are owner-confirmed without early earnings or an impossible acceptance request', async t=>{
  const f=await setup(t), input={startLocal:'2026-11-16T10:00',endLocal:'2026-11-16T12:00',confirmWorked:true,confirmedStart:localInstant('2026-11-16T10:00'),confirmedEnd:localInstant('2026-11-16T12:00')};
  assert.equal((await create(f,{...input,confirmCompleted:true})).result.status,400);
  const {request,result}=await create(f,input); assert.equal(result.status,200);
  assert.equal((await schedule(f)).assignments[0].status,'accepted');
  assert.equal((await f.call('jordyn','/creative-work')).data.assignments.length,0);
  assert.equal((await f.call('jordyn','/alerts')).data.alerts[0].title,'Shift confirmed by Smooth');
  t.mock.timers.setTime(Date.parse('2026-11-16T18:00Z'));
  assert.equal((await f.call('owner',`/assignments/${request.id}`,{revision:(await schedule(f)).revision,action:'complete-task',confirmCompleted:true})).status,200);
  assert.equal((await f.call('jordyn','/creative-work')).data.assignments.length,1);
});
test('retrospective recording preserves shift duration, future-offer and work-type validation', async t=>{
  const f=await setup(t);
  assert.equal((await create(f,{...pastShift(),endLocal:'2026-11-17T14:00'})).result.status,400);
  assert.equal((await create(f,{confirmWorked:true})).result.status,400);
  assert.equal((await create(f,{...pastShift(),workType:undefined})).result.status,400);
});
