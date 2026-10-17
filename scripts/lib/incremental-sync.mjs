import { randomUUID } from 'node:crypto';
import { recordManifest, recordDelta, recordBatches } from '../../lib/sync-records.mjs';

// Stage differences in bounded requests, then atomically verify and apply the
// complete result. A lost/partial upload cannot hide existing appointments.
export async function syncRecords({ request, prefix, records, key, field, time }) {
  const desired = await recordManifest(records, key);
  for (let attempt = 0; attempt < 3; attempt++) {
    const saved = await request(`${prefix}/manifest`);
    if (saved.version !== 1 || !Array.isArray(saved.entries)) throw new Error('Deploy the updated sync backend before importing.');
    const { changed, removed } = recordDelta(records, desired, saved, key);
    const generation = randomUUID();
    try {
      for (const chunk of recordBatches(changed)) {
        await request(`${prefix}/import`, { generation, incremental: true, ...time, [field]: chunk });
      }
      return await request(`${prefix}/commit`, { generation, incremental: true, ...time,
        baseGeneration: saved.generation, baseSyncedAt: saved.syncedAt, changedCount: changed.length,
        removed, count: records.length, hash: desired.hash });
    } catch (error) {
      // Only a concurrent snapshot/CAS conflict can be retried automatically.
      // Authentication, network and validation failures preserve the old data.
      if (error.status !== 409 || attempt === 2) throw error;
    }
  }
}
