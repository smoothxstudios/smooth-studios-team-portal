import { DEFAULT_PAY_WORK_TYPES, payWorkTypeLabel } from '../lib/pay-work-types.mjs';

export async function payWorkTypesRoute({ request, db, user, body, fail }) {
  if (user !== 'owner') fail(403, 'Only Smooth can manage pay work types.');
  if (request.method === 'GET') {
    const rows = await db.prepare('SELECT id, label FROM owner_pay_work_types ORDER BY label COLLATE NOCASE').all();
    return { options: [...DEFAULT_PAY_WORK_TYPES, ...rows.results] };
  }
  if (request.method !== 'POST') fail(405, 'Choose Add option to save a work type.');
  const input = await body(request);
  let label;
  try { label = payWorkTypeLabel(input.label); } catch (error) { fail(400, error.message); }
  const normalized = label.toLowerCase();
  const preset = DEFAULT_PAY_WORK_TYPES.find(item => item.label.toLowerCase() === normalized);
  if (preset) return { option: preset, existing: true };
  // Case-insensitive uniqueness makes retries and simultaneous saves harmless.
  const result = await db.prepare(`INSERT OR IGNORE INTO owner_pay_work_types(id,label,normalized_label,created_at)
    SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM owner_pay_work_types) < 100`)
    .bind(`custom-${crypto.randomUUID()}`, label, normalized, new Date().toISOString()).run();
  const option = await db.prepare('SELECT id,label FROM owner_pay_work_types WHERE normalized_label=?').bind(normalized).first();
  if (!option) fail(400, 'You have reached the limit of 100 custom work types.');
  return { option, existing: !result.meta.changes };
}
