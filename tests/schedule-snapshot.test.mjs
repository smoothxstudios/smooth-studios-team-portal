import assert from 'node:assert/strict';
import test from 'node:test';
import { applyConfirmedScheduleMutation, readScheduleSnapshot } from '../lib/schedule-snapshot.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('background reads wait for an editor, including one opened during the request', async () => {
  let editing = true, reads = 0;
  const updates = [], pending = deferred();
  const options = { read: () => { reads++; return pending.promise; }, canApply: () => !editing, onSnapshot: value => updates.push(value) };
  assert.equal(await readScheduleSnapshot(options), false);
  assert.equal(reads, 0);
  editing = false;
  const result = readScheduleSnapshot(options);
  editing = true;
  pending.resolve({ revision: 2 });
  assert.equal(await result, false);
  assert.deepEqual(updates, []);
  editing = false;
  assert.equal(await readScheduleSnapshot(options), true);
  assert.deepEqual(updates, [{ revision: 2 }]);
});

test('an older response cannot roll back a newer response or a confirmed write', async () => {
  let version = 0, snapshot = { revision: 1 };
  const first = deferred(), second = deferred();
  const run = pending => {
    const ownVersion = ++version;
    return readScheduleSnapshot({ read: () => pending.promise, canApply: () => ownVersion === version, onSnapshot: next => { snapshot = next; } });
  };
  const older = run(first), newer = run(second);
  second.resolve({ revision: 3 });
  assert.equal(await newer, true);
  first.resolve({ revision: 2 });
  assert.equal(await older, false);
  assert.equal(snapshot.revision, 3);
  const late = deferred(), stale = run(late);
  ++version; // Starting a write invalidates background reads immediately.
  snapshot = { revision: 4, status: 'accepted' };
  late.resolve({ revision: 3, status: 'pending' });
  assert.equal(await stale, false);
  assert.equal(snapshot.status, 'accepted');
});

test('failed reads preserve the last usable schedule and report failure to their caller', async () => {
  let applied = false;
  await assert.rejects(readScheduleSnapshot({
    read: async () => { throw new Error('offline'); }, canApply: () => true, onSnapshot: () => { applied = true; },
  }), /offline/);
  assert.equal(applied, false);
});

const original = () => ({
  revision: 8,
  appointments: [{ id: 'rental', acceptedEmployeeIds: ['jordyn', 'rayne'], calendarInvitations: [{ employeeId: 'jordyn' }, { employeeId: 'rayne' }] }],
  assignments: [
    { id: 'offer', appointmentId: 'rental', employeeId: 'jordyn', start: '10', end: '11', status: 'pending' },
    { id: 'old', appointmentId: 'rental', employeeId: 'jordyn', start: '9', end: '10', status: 'accepted' },
    { id: 'other', appointmentId: 'rental', employeeId: 'rayne', start: '10', end: '11', status: 'accepted' },
  ], blocks: [{ id: 'block' }], workPreferences: [{ id: 'preference' }],
});

test('a confirmed app response stays visible even when its follow-up read fails', () => {
  const before = original();
  const after = applyConfirmedScheduleMutation(before, '/assignments/offer', { status: 'accepted' }, {});
  assert.equal(after.assignments[0].status, 'accepted');
  assert.equal(before.assignments[0].status, 'pending');
  assert.equal(after.revision, before.revision, 'wait for an authoritative read before another write');
  assert.equal(after.assignments[1], before.assignments[1]);
  assert.equal(after.appointments, before.appointments);
  assert.equal(after.blocks, before.blocks);
});

test('confirmed staff removal preserves other people, previous times and availability', () => {
  const before = original(), removed = { ...before.assignments[0], id: 'removed', status: 'cancelled' };
  const after = applyConfirmedScheduleMutation(before, '/rental-staff/remove', {}, { removedAssignment: removed });
  assert.deepEqual(after.appointments[0].acceptedEmployeeIds, ['rayne']);
  assert.deepEqual(after.appointments[0].calendarInvitations, [{ employeeId: 'rayne' }]);
  assert.equal(after.assignments.find(a => a.id === 'offer').status, 'cancelled');
  assert.equal(after.assignments.find(a => a.id === 'old').status, 'accepted');
  assert.equal(after.assignments.find(a => a.id === 'other').status, 'accepted');
  assert.equal(after.assignments.filter(a => a.id === removed.id).length, 1);
  assert.equal(after.workPreferences, before.workPreferences);
  assert.deepEqual(before.appointments[0].acceptedEmployeeIds, ['jordyn', 'rayne']);
  assert.equal(applyConfirmedScheduleMutation(before, '/rental-staff/remove', {}, {}), before);
});
