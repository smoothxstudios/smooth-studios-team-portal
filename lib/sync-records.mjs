// Identical normalization on the importer and Worker keeps timestamps, object
// property order and Calendar guest order from creating unnecessary writes.
export function calendarRecord(a) {
  return { id: a.id.trim(), title: a.title.trim(), customer: (a.customer ?? '').trim(),
    start: new Date(a.start).toISOString(), end: new Date(a.end).toISOString(), priceCents: a.priceCents,
    rentalDetails: (a.rentalDetails ?? '').trim(), acceptedEmployeeIds: [...new Set(a.acceptedEmployeeIds)].sort(),
    calendarInvitations: (a.calendarInvitations ?? []).map(({ employeeId, status }) => ({ employeeId, status }))
      .sort((a, b) => a.employeeId.localeCompare(b.employeeId)) };
}
export const calendarKey = a => a.id;
export function payrollRecord(r) {
  return { employeeId: r.employeeId, rentalId: r.rentalId, amountCents: r.amountCents,
    paidCents: r.paidCents, earnedAt: new Date(r.earnedAt).toISOString(), eligible: r.eligible };
}
export const payrollKey = r => JSON.stringify([r.employeeId, r.rentalId]);
export function recordBatches(records) {
  const batches = []; let chunk = [], bytes = 0;
  for (const row of records) {
    const size = new TextEncoder().encode(JSON.stringify(row)).byteLength + 1;
    if (size > 180_000) throw new Error('A sync record exceeds the upload limit.');
    if (chunk.length >= 50 || bytes + size > 180_000) { batches.push(chunk); chunk = []; bytes = 0; }
    chunk.push(row); bytes += size;
  }
  if (chunk.length) batches.push(chunk);
  return batches;
}
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(JSON.stringify(value)))), b => b.toString(16).padStart(2, '0')).join('');

export async function recordManifest(records, key) {
  const entries = await Promise.all(records.map(async r => [key(r), await hash(r)]));
  entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  if (new Set(entries.map(([id]) => id)).size !== entries.length) throw new Error('Duplicate sync record.');
  return { version: 1, entries, hash: await hash(entries) };
}

export function recordDelta(records, desired, saved, key) {
  const old = new Map(saved.entries), hashes = new Map(desired.entries);
  return { changed: records.filter(r => old.get(key(r)) !== hashes.get(key(r))),
    removed: saved.entries.filter(([id]) => !hashes.has(id)).map(([id]) => id) };
}

export async function verifyDelta(current, staged, input, key, fail) {
  if (!Array.isArray(input.removed) || input.removed.length > 100_000 ||
      input.removed.some(id => typeof id !== 'string') || new Set(input.removed).size !== input.removed.length ||
      !Number.isSafeInteger(input.changedCount) || input.changedCount !== staged.length ||
      !Number.isSafeInteger(input.count) || input.count < 0 || !/^[a-f0-9]{64}$/.test(input.hash ?? '')) {
    fail(409, 'The changed-record import is incomplete. Retry the sync.');
  }
  const next = new Map(current.map(r => [key(r), r])), removed = new Set(input.removed);
  if (input.removed.some(id => !next.has(id)) || staged.some(r => removed.has(key(r)))) fail(409, 'The sync changes do not match the saved records.');
  const stats = { inserted: 0, updated: 0, removed: removed.size, unchanged: current.length - removed.size };
  for (const r of staged) {
    if (next.has(key(r))) { stats.updated++; stats.unchanged--; } else stats.inserted++;
    next.set(key(r), r);
  }
  removed.forEach(id => next.delete(id));
  const records = [...next.values()];
  if (records.length !== input.count || (await recordManifest(records, key)).hash !== input.hash) {
    fail(409, 'The complete sync contents could not be verified. Existing records were preserved.');
  }
  return { records, stats };
}
