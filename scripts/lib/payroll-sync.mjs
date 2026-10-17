import { readFile } from 'node:fs/promises';
import { teamToken } from '../../lib/team-auth.mjs';
import { TEAM_API_URL } from '../../lib/team-schedule.mjs';
import { applyRentalAdvances, scopedPayroll } from '../../lib/payroll-advances.mjs';
import { payrollRecord, payrollKey } from '../../lib/sync-records.mjs';
import { syncRecords } from './incremental-sync.mjs';

export async function syncPayroll(payloads, ownerPassword) {
  const token = await teamToken(ownerPassword, 'sync');
  async function request(path, data) {
    const response = await fetch(`${TEAM_API_URL}${path}`, { method: data ? 'POST' : 'GET', redirect: 'error',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw Object.assign(new Error(`Payroll synchronization failed (${response.status}). Existing dashboards were preserved.`), { status: response.status });
    return response.json();
  }
  const asOf = new Date().toISOString();
  const earnings = payloads.owner.rentals.flatMap(rental => Object.entries(rental.employeePayouts).map(([employeeId, payout]) => payrollRecord({
    employeeId, rentalId: rental.id, amountCents: payout.amountCents,
    paidCents: payout.recordedPaidAmountCents ?? payout.paidAmountCents ?? (payout.paid ? payout.amountCents : 0),
    earnedAt: new Date(rental.end).toISOString(),
    eligible: rental.fullyPaid && Date.parse(rental.end) <= Date.parse(asOf) && payout.compensationConfigured !== false,
  })));
  let payroll = await syncRecords({ request, prefix: '/sync/payroll', records: earnings, key: payrollKey,
    field: 'earnings', time: { asOf } });
  process.stdout.write(`Payroll database sync: ${JSON.stringify(payroll.syncStats)}\n`);
  // Imports are authenticated, encrypted, and idempotent. They are applied only
  // after the current paid-through ledger and Calendar earnings are imported.
  let envelope;
  try { envelope = JSON.parse(await readFile(new URL('../../data/payroll-advance-import.json', import.meta.url), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (envelope) {
    payroll = await request('/sync/payroll/advances', envelope);
    if (!payroll.imported) throw new Error('The payroll advance import was not confirmed.');
    process.stdout.write('Encrypted payroll advance import verified.\n');
  }
  for (const [id, payload] of Object.entries(payloads)) {
    const snapshot = id === 'owner' ? payroll : scopedPayroll(payroll, id);
    payload.payroll = snapshot;
    payload.rentals = applyRentalAdvances(payload.rentals, snapshot);
  }
  process.stdout.write('Payroll balances reconciled without duplicate advance deductions.\n');
}
