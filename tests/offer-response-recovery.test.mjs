import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/notification-fixture.mjs';
import { saveScheduleMutation } from '../lib/team-schedule-mutations.mjs';

test('an employee with overlapping rentals can accept after owner approval races their open view', async () => {
  const f = await fixture(); delete f.env.VAPID_JWK;
  try {
    const start = new Date(Date.now() + 86400000).toISOString(), end = new Date(Date.now() + 90000000).toISOString();
    const rentals = ['A', 'B'].map(studio => ({ id: `synthetic-${studio}`, title: `Studio ${studio} Rental`, start, end, priceCents: 5000, customer: '', acceptedEmployeeIds: [] }));
    const generation = crypto.randomUUID();
    const imported = await f.call('sync', '/sync/import', { generation, appointments: rentals });
    assert.equal(imported.status, 200, JSON.stringify(imported.data));
    const committed = await f.call('sync', '/sync/commit', { generation, count: 2 });
    assert.equal(committed.status, 200, JSON.stringify(committed.data));
    const read = async () => (await f.call('rayne', '/schedule')).data;
    assert.equal((await f.call('owner', '/assignments', { revision: (await read()).revision, employeeId: 'rayne', appointmentId: rentals[0].id })).status, 200);
    const original = await read(), item = original.assignments[0];
    // Another overlapping offer arrives, then the owner explicitly approves A.
    assert.equal((await f.call('owner', '/assignments', { revision: (await read()).revision, employeeId: 'rayne', appointmentId: rentals[1].id, overrideConflicts: true })).status, 200);
    assert.equal((await f.call('owner', `/assignments/${item.id}`, { revision: (await read()).revision, overrideConflicts: true })).status, 200);
    const attempts = [];
    const result = await saveScheduleMutation({ path: `/assignments/${item.id}`, method: 'POST', data: { status: 'accepted' },
      revision: original.revision, userId: 'rayne', isOwner: false, assignments: original.assignments,
      refresh: read, onRefresh: () => {}, write: async revision => {
        const response = await f.call('rayne', `/assignments/${item.id}`, { revision, status: 'accepted' });
        attempts.push(response.status);
        if (response.status !== 200) throw new Error(response.data.error);
        return response.data;
      } });
    assert.equal(result.saved, true); assert.deepEqual(attempts, [409, 200]);
    assert.equal((await read()).assignments.find(a => a.id === item.id).status, 'accepted');
  } finally { await Promise.allSettled(f.pending); f.close(); }
});
