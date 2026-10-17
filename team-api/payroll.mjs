import { TEAM } from "../lib/team-schedule.mjs";
import { unbase64url } from "../lib/team-auth.mjs";
import { payrollRecord, payrollKey, recordManifest, verifyDelta, recordBatches } from '../lib/sync-records.mjs';
import { trackImport, cleanImports } from './sync-storage.mjs';

const earningRecord = row => payrollRecord({ employeeId: row.employee_id, rentalId: row.rental_id,
  amountCents: row.amount_cents, paidCents: row.paid_cents, earnedAt: row.earned_at, eligible: row.eligible === 1 });

// Every allocation is one SQLite statement: the available advance and unpaid
// earnings are read in the same write transaction. Concurrent reads, approvals,
// syncs and retries cannot consume the same balance twice.
const allocateSql = `WITH credit AS (
  SELECT a.id, a.employee_id, a.amount_cents - COALESCE(SUM(p.amount_cents),0) AS available
  FROM payroll_advances a LEFT JOIN payroll_advance_allocations p ON p.advance_id = a.id
  WHERE a.id = ? GROUP BY a.id
), allocations AS (
  SELECT p.source_kind, p.source_id, SUM(p.amount_cents) AS applied, MAX(p.cash_floor_cents) AS floor
  FROM payroll_advance_allocations p JOIN payroll_advances a ON a.id = p.advance_id
  JOIN credit c ON c.employee_id = a.employee_id GROUP BY p.source_kind, p.source_id
), sources AS (
  SELECT s.*, COALESCE(a.applied,0) AS applied,
    CASE WHEN s.kind = 'rental' AND a.applied > 0 THEN MAX(a.floor, s.recorded_paid - a.applied)
      ELSE s.recorded_paid END AS cash_paid
  FROM payroll_sources s JOIN credit c ON c.employee_id = s.employee_id
  LEFT JOIN allocations a ON a.source_kind = s.kind AND a.source_id = s.id
), owing AS (
  SELECT *, MAX(0, amount_cents - cash_paid - applied) AS outstanding FROM sources
), ordered AS (
  SELECT *, COALESCE(SUM(outstanding) OVER (ORDER BY earned_at, kind, id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS prior
  FROM owing WHERE outstanding > 0
)
INSERT INTO payroll_advance_allocations(advance_id, source_kind, source_id, amount_cents, cash_floor_cents, created_at)
SELECT c.id, o.kind, o.id, MIN(o.outstanding, c.available - o.prior), o.cash_paid, ?
FROM ordered o CROSS JOIN credit c WHERE c.available > o.prior
ON CONFLICT(advance_id, source_kind, source_id) DO UPDATE SET
  amount_cents = payroll_advance_allocations.amount_cents + excluded.amount_cents,
  cash_floor_cents = MAX(payroll_advance_allocations.cash_floor_cents, excluded.cash_floor_cents)`;

export async function reconcileAdvances(db) {
  const pending = await db.prepare(`SELECT a.id FROM payroll_advances a LEFT JOIN payroll_advance_allocations p ON p.advance_id = a.id
    GROUP BY a.id HAVING a.amount_cents > COALESCE(SUM(p.amount_cents),0) ORDER BY a.created_at, a.id`).all();
  for (const row of pending.results) await db.prepare(allocateSql).bind(row.id, new Date().toISOString()).run();
}

export async function creativeAdvanceAmounts(db, employeeId) {
  const rows = await db.prepare(`SELECT p.source_id, SUM(p.amount_cents) AS amount
    FROM payroll_advance_allocations p JOIN payroll_advances a ON a.id = p.advance_id
    WHERE p.source_kind = 'creative' AND (? IS NULL OR a.employee_id = ?) GROUP BY p.source_id`)
    .bind(employeeId ?? null, employeeId ?? null).all();
  return new Map(rows.results.map(row => [row.source_id, Number(row.amount)]));
}
export async function withCreativeAdvance(db, item) {
  const amounts = await creativeAdvanceAmounts(db, item.employeeId);
  return { ...item, advanceAppliedCents: Math.min(item.amountCents, amounts.get(item.id) ?? 0) };
}

async function payrollState(db, user) {
  const employee = user === 'owner' || user === 'sync' ? null : user;
  const [state, balances, allocations, reviews] = await Promise.all([
    db.prepare("SELECT synced_at FROM payroll_state WHERE id = 1").first(),
    db.prepare(`SELECT a.employee_id, SUM(a.amount_cents) AS total, SUM(COALESCE(p.applied,0)) AS applied
      FROM payroll_advances a LEFT JOIN (SELECT advance_id, SUM(amount_cents) AS applied FROM payroll_advance_allocations GROUP BY advance_id) p ON p.advance_id = a.id
      WHERE (? IS NULL OR a.employee_id = ?) GROUP BY a.employee_id`).bind(employee, employee).all(),
    db.prepare(`SELECT a.employee_id, p.source_kind, p.source_id, SUM(p.amount_cents) AS amount, MAX(p.cash_floor_cents) AS floor
      FROM payroll_advance_allocations p JOIN payroll_advances a ON a.id = p.advance_id
      WHERE (? IS NULL OR a.employee_id = ?) GROUP BY a.employee_id, p.source_kind, p.source_id`).bind(employee, employee).all(),
    // Preserve the ledger if source data later changes. Do not silently create
    // new available credit or settle a different earning with the same money.
    db.prepare(`SELECT a.employee_id, p.source_kind, p.source_id, SUM(p.amount_cents) AS applied
      FROM payroll_advance_allocations p JOIN payroll_advances a ON a.id = p.advance_id
      LEFT JOIN payroll_sources s ON s.employee_id = a.employee_id AND s.kind = p.source_kind AND s.id = p.source_id
      WHERE (? IS NULL OR a.employee_id = ?) GROUP BY a.employee_id, p.source_kind, p.source_id
      HAVING s.id IS NULL OR SUM(p.amount_cents) > s.amount_cents OR (p.source_kind = 'rental' AND SUM(p.amount_cents) + MAX(p.cash_floor_cents) > s.amount_cents)`).bind(employee, employee).all(),
  ]);
  return { version: 1, syncedAt: state?.synced_at ?? null,
    balances: balances.results.map(row => ({ employeeId: row.employee_id, totalCents: Number(row.total), appliedCents: Number(row.applied), remainingCents: Math.max(0, Number(row.total) - Number(row.applied)) })),
    allocations: allocations.results.map(row => ({ employeeId: row.employee_id, kind: row.source_kind, sourceId: row.source_id, amountCents: Number(row.amount), cashFloorCents: Number(row.floor) })),
    reviewCount: reviews.results.length };
}

export async function payrollRoute({ request, db, user, env, body, fail }) {
  const path = new URL(request.url).pathname;
  const isSync = user === 'sync';
  if (isSync && request.method === 'GET' && path === '/sync/payroll/manifest') {
    await cleanImports(db, 'payroll');
    const state = await db.prepare('SELECT generation, synced_at FROM payroll_state WHERE id = 1').first();
    const rows = (await db.prepare('SELECT * FROM payroll_rental_earnings WHERE generation = ?').bind(state.generation).all()).results;
    return { ...await recordManifest(rows.map(earningRecord), payrollKey), generation: state.generation, syncedAt: state.synced_at };
  }
  if (request.method === 'GET' && ['/payroll', '/sync/payroll'].includes(path)) {
    await reconcileAdvances(db); return payrollState(db, user);
  }
  const input = await body(request);
  const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
  const employee = value => TEAM.some(person => person.id === value && person.id !== 'owner');
  const cents = value => Number.isSafeInteger(value) && value >= 0 && value <= 100_000_000;
  const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  if (isSync && request.method === 'POST' && path === '/sync/payroll/import') {
    if (!uuid(input.generation) || !iso(input.asOf) || Date.parse(input.asOf) > Date.now() + 60_000 || !Array.isArray(input.earnings) || input.earnings.length > 100) fail(400, 'Invalid payroll snapshot.');
    const state = await db.prepare('SELECT * FROM payroll_state WHERE id = 1').first();
    if (state.generation === input.generation || (state.synced_at && state.synced_at >= input.asOf)) fail(409, 'A newer payroll snapshot is already active.');
    const rows = input.earnings.map(item => {
      if (!employee(item.employeeId) || typeof item.rentalId !== 'string' || !item.rentalId || item.rentalId.length > 1024 || !cents(item.amountCents) || !cents(item.paidCents) || item.paidCents > item.amountCents || !iso(item.earnedAt) || typeof item.eligible !== 'boolean' || (item.eligible && Date.parse(item.earnedAt) > Date.parse(input.asOf))) fail(400, 'Invalid rental earnings.');
      return db.prepare(`INSERT INTO payroll_rental_earnings(generation, employee_id, rental_id, amount_cents, paid_cents, earned_at, eligible, as_of)
        SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS(SELECT 1 FROM payroll_state WHERE generation = ?)
        ON CONFLICT(generation,employee_id,rental_id) DO UPDATE SET amount_cents=excluded.amount_cents, paid_cents=excluded.paid_cents, earned_at=excluded.earned_at, eligible=excluded.eligible, as_of=excluded.as_of
        WHERE amount_cents != excluded.amount_cents OR paid_cents != excluded.paid_cents OR earned_at != excluded.earned_at OR eligible != excluded.eligible OR as_of != excluded.as_of`)
        .bind(input.generation, item.employeeId, item.rentalId, item.amountCents, item.paidCents, item.earnedAt, Number(item.eligible), input.asOf, input.generation);
    });
    if (input.incremental === true) await trackImport(db, 'payroll', input.generation);
    if (rows.length) await db.batch(rows);
    return { imported: rows.length };
  }
  if (isSync && request.method === 'POST' && path === '/sync/payroll/commit') {
    if (!uuid(input.generation) || !iso(input.asOf) || Date.parse(input.asOf) > Date.now() + 60_000 || !Number.isSafeInteger(input.count) || input.count < 0 || input.count > 100_000) fail(400, 'Invalid payroll snapshot.');
    if (input.incremental === true) {
      const state = await db.prepare('SELECT * FROM payroll_state WHERE id = 1').first();
      if (Date.parse(input.asOf) < Date.now() - 86400_000 || input.generation === state.generation ||
          input.baseGeneration !== state.generation || input.baseSyncedAt !== state.synced_at ||
          (state.synced_at && input.asOf <= state.synced_at)) fail(409, 'A newer payroll sync is already saved. Retry with current data.');
      const current = (await db.prepare('SELECT * FROM payroll_rental_earnings WHERE generation = ?').bind(state.generation).all()).results;
      const staged = (await db.prepare('SELECT * FROM payroll_rental_earnings WHERE generation = ?').bind(input.generation).all()).results;
      if (staged.some(row => row.as_of !== input.asOf)) fail(409, 'The payroll import contains a different snapshot.');
      const { stats } = await verifyDelta(current.map(earningRecord), staged.map(earningRecord), input, payrollKey, fail);
      const mutation = crypto.randomUUID(), guard = 'EXISTS(SELECT 1 FROM payroll_state WHERE id = 1 AND mutation = ?)';
      const result = await db.batch([
        db.prepare('UPDATE payroll_state SET synced_at = ?, mutation = ? WHERE id = 1 AND generation = ? AND synced_at IS ?')
          .bind(input.asOf, mutation, state.generation, state.synced_at),
        ...recordBatches(staged.map(earningRecord)).map(rows => db.prepare(`INSERT INTO payroll_rental_earnings
          (generation, employee_id, rental_id, amount_cents, paid_cents, earned_at, eligible, as_of)
          SELECT ?, json_extract(value,'$.employeeId'), json_extract(value,'$.rentalId'), json_extract(value,'$.amountCents'),
            json_extract(value,'$.paidCents'), json_extract(value,'$.earnedAt'), json_extract(value,'$.eligible'), ?
          FROM json_each(?) WHERE ${guard}
          ON CONFLICT(generation,employee_id,rental_id) DO UPDATE SET amount_cents=excluded.amount_cents,
            paid_cents=excluded.paid_cents, earned_at=excluded.earned_at, eligible=excluded.eligible, as_of=excluded.as_of
          WHERE payroll_rental_earnings.amount_cents != excluded.amount_cents OR payroll_rental_earnings.paid_cents != excluded.paid_cents
            OR payroll_rental_earnings.earned_at != excluded.earned_at OR payroll_rental_earnings.eligible != excluded.eligible`)
          .bind(state.generation, input.asOf, JSON.stringify(rows), mutation)),
        db.prepare(`DELETE FROM payroll_rental_earnings WHERE generation = ?
          AND json_array(employee_id, rental_id) IN (SELECT value FROM json_each(?)) AND ${guard}`)
          .bind(state.generation, JSON.stringify(input.removed), mutation),
        db.prepare(`DELETE FROM payroll_rental_earnings WHERE generation = ? AND ${guard}`).bind(input.generation, mutation),
        db.prepare(`DELETE FROM sync_imports WHERE kind = 'payroll' AND generation = ? AND ${guard}`).bind(input.generation, mutation),
      ]);
      if (!result[0].meta.changes) fail(409, 'Payroll changed during the sync. Existing records were preserved.');
      await reconcileAdvances(db);
      return { ...await payrollState(db, user), syncStats: stats };
    }
    const result = await db.prepare(`UPDATE payroll_state SET generation = ?, synced_at = ? WHERE id = 1 AND (synced_at IS NULL OR synced_at < ?)
      AND (SELECT COUNT(*) FROM payroll_rental_earnings WHERE generation = ? AND as_of = ?) = ?
      AND NOT EXISTS(SELECT 1 FROM payroll_rental_earnings WHERE generation = ? AND as_of != ?)`)
      .bind(input.generation, input.asOf, input.asOf, input.generation, input.asOf, input.count, input.generation, input.asOf).run();
    if (!result.meta.changes) fail(409, 'The payroll snapshot is incomplete or out of date.');
    await reconcileAdvances(db);
    await db.prepare('DELETE FROM payroll_rental_earnings WHERE generation != (SELECT generation FROM payroll_state WHERE id = 1) AND as_of < ?').bind(input.asOf).run();
    return payrollState(db, user);
  }
  if (isSync && request.method === 'POST' && path === '/sync/payroll/advances') {
    let value;
    if (!uuid(input.id) || !env.STUDIO_REFERENCE_KEY) fail(400, 'Invalid encrypted payroll import.');
    try {
      const privateKey = await crypto.subtle.importKey('jwk', JSON.parse(env.STUDIO_REFERENCE_KEY), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
      const rawKey = await crypto.subtle.decrypt('RSA-OAEP', privateKey, unbase64url(input.wrappedKey));
      const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64url(input.iv), additionalData: new TextEncoder().encode(`smooth-payroll-advance:v1:${input.id}`) }, key, unbase64url(input.ciphertext));
      value = JSON.parse(new TextDecoder().decode(plain));
    } catch { fail(400, 'The encrypted payroll import could not be read.'); }
    if (!employee(value.employeeId) || !cents(value.amountCents) || value.amountCents <= 0 || value.basis !== 'unpaid-and-future') fail(400, 'Invalid advance details.');
    const state = await db.prepare('SELECT synced_at FROM payroll_state WHERE id = 1').first();
    if (!state?.synced_at || Date.now() - Date.parse(state.synced_at) > 10 * 60_000) fail(409, 'Sync current payroll before recording an advance.');
    await db.prepare('INSERT OR IGNORE INTO payroll_advances(id, employee_id, amount_cents, created_at, basis) VALUES (?, ?, ?, ?, ?)')
      .bind(input.id, value.employeeId, value.amountCents, new Date().toISOString(), value.basis).run();
    const saved = await db.prepare('SELECT * FROM payroll_advances WHERE id = ?').bind(input.id).first();
    if (saved.employee_id !== value.employeeId || saved.amount_cents !== value.amountCents || saved.basis !== value.basis) fail(409, 'This import identifier belongs to a different advance.');
    await reconcileAdvances(db);
    return { imported: true, ...await payrollState(db, user) };
  }
  fail(404, 'Payroll endpoint not found.');
}
