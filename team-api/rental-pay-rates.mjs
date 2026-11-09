import { TEAM } from '../lib/team-schedule.mjs';
import { sameRentalPay, validateRentalPay } from '../lib/rental-pay-rates.mjs';
const employees = new Set(TEAM.filter(person => person.id !== 'owner').map(person => person.id));

export async function readRentalPayRates(db) {
  // One snapshot keeps the revision and its history consistent during a save.
  const { results } = await db.prepare(`SELECT p.employee_id, p.baseline, p.revision,
    c.id, c.revision AS change_revision, c.effective_at, c.compensation
    FROM rental_pay_policies p LEFT JOIN rental_pay_rate_changes c ON c.employee_id=p.employee_id
    ORDER BY p.employee_id, c.revision`).all();
  const rates = new Map();
  for (const row of results) {
    if (!rates.has(row.employee_id)) rates.set(row.employee_id, {
      employeeId: row.employee_id, revision: row.revision, compensation: JSON.parse(row.baseline), effectiveAt: null, history: [],
    });
    const rate = rates.get(row.employee_id);
    if (row.id) {
      const change = { id: row.id, revision: row.change_revision, effectiveAt: row.effective_at, compensation: JSON.parse(row.compensation) };
      rate.history.push(change); rate.compensation = change.compensation; rate.effectiveAt = change.effectiveAt;
    }
  }
  return { rates: [...rates.values()] };
}

export async function rentalPayRatesRoute({ request, db, user, body, fail }) {
  const path = new URL(request.url).pathname;
  const sync = path === '/sync/rental-pay-rates';
  if (sync ? user !== 'sync' : user !== 'owner') fail(403, 'Only Smooth can view or change team rental pay rates.');
  if (sync && request.method === 'POST') {
    const input = await body(request);
    if (!Array.isArray(input.employees) || input.employees.length > employees.size) fail(400, 'Invalid rental pay setup.');
    const seen = new Set();
    const statements = input.employees.map(person => {
      if (!employees.has(person?.employeeId) || seen.has(person.employeeId)) fail(400, 'Choose one valid team member per rate.');
      seen.add(person.employeeId);
      let pay;
      try { pay = person.compensation?.type === 'pending' ? { type: 'pending' } : validateRentalPay(person.compensation); }
      catch (error) { fail(400, error.message); }
      // Imports can refresh a default, but can never replace an owner's saved rate.
      return db.prepare(`INSERT INTO rental_pay_policies(employee_id, baseline) VALUES (?, ?)
        ON CONFLICT(employee_id) DO UPDATE SET baseline=excluded.baseline WHERE rental_pay_policies.revision=0`)
        .bind(person.employeeId, JSON.stringify(pay));
    });
    if (statements.length) await db.batch(statements);
    return readRentalPayRates(db);
  }
  if (request.method === 'GET') return readRentalPayRates(db);
  if (sync || request.method !== 'PUT') fail(405, 'This pay rate action is not available.');
  const input = await body(request);
  if (!employees.has(input.employeeId)) fail(400, 'Choose a team member.');
  if (!Number.isSafeInteger(input.revision) || input.revision < 0 || !/^[a-f0-9-]{36}$/.test(input.id ?? '')) fail(400, 'Reload rates before saving.');
  let compensation;
  try { compensation = validateRentalPay(input.compensation); } catch (error) { fail(400, error.message); }
  async function replay() {
    const previous = await db.prepare('SELECT employee_id, compensation FROM rental_pay_rate_changes WHERE id=?').bind(input.id).first();
    if (!previous) return null;
    if (previous.employee_id !== input.employeeId || !sameRentalPay(JSON.parse(previous.compensation), compensation)) fail(409, 'This save was already used for a different rate. Reload rates.');
    const snapshot = await readRentalPayRates(db);
    return { rate: snapshot.rates.find(item => item.employeeId === input.employeeId), saved: true, duplicate: true };
  }
  const duplicate = await replay();
  if (duplicate) return duplicate;
  const rate = (await readRentalPayRates(db)).rates.find(item => item.employeeId === input.employeeId);
  if (!rate) fail(409, 'Rates are still loading from the studio sync. Reload rates shortly.');
  if (rate.revision !== input.revision) fail(409, 'This rate changed on another device. Reload rates, review the current rate, and save again.');
  if (sameRentalPay(rate.compensation, compensation)) return { rate, saved: true, unchanged: true };
  const effectiveAt = new Date().toISOString();
  let results;
  try { results = await db.batch([
    db.prepare('UPDATE rental_pay_policies SET revision=revision+1, mutation=? WHERE employee_id=? AND revision=?').bind(input.id, input.employeeId, input.revision),
    db.prepare(`INSERT INTO rental_pay_rate_changes(id, employee_id, revision, effective_at, compensation)
      SELECT ?, employee_id, revision, ?, ? FROM rental_pay_policies WHERE employee_id=? AND mutation=?`)
      .bind(input.id, effectiveAt, JSON.stringify(compensation), input.employeeId, input.id),
  ]); } catch (error) {
    // D1 rolls the batch back if two identical requests race on the history ID.
    const saved = await replay();
    if (saved) return saved;
    throw error;
  }
  if (!results[0].meta.changes) fail(409, 'This rate changed on another device. Reload rates before saving.');
  const change = { id: input.id, revision: rate.revision + 1, effectiveAt, compensation };
  return { saved: true, rate: { ...rate, ...change, history: [...rate.history, change] } };
}
