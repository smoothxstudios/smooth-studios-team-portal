import { teamToken } from '../../lib/team-auth.mjs';
import { TEAM_API_URL } from '../../lib/team-schedule.mjs';
import { rentalPayAt, validateRentalPay } from '../../lib/rental-pay-rates.mjs';

/** Fail closed: a rate read failure must never republish earnings at old defaults. */
export const syncRentalPayRates = (config, ownerPassword, send = fetch) => loadRentalPayRates(config, ownerPassword, send, true);
export const readRentalPayRates = (config, ownerPassword, send = fetch) => loadRentalPayRates(config, ownerPassword, send, false);

async function loadRentalPayRates(config, ownerPassword, send, initialize) {
  const token = await teamToken(ownerPassword, 'sync');
  const response = await send(`${TEAM_API_URL}/sync/rental-pay-rates`, {
    method: initialize ? 'POST' : 'GET', redirect: 'error', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(initialize ? { body: JSON.stringify({ employees: config.employees.map(employee => ({ employeeId: employee.id, compensation: rentalPayAt(employee, config, Date.now(), false) })) }) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Rental pay rates could not load (${response.status}). Existing earnings were preserved.`);
  const result = await response.json();
  if (!Array.isArray(result.rates)) throw new Error('Rental pay rates were incomplete. Existing earnings were preserved.');
  return config.employees.map(employee => {
    const rate = result.rates.find(row => row.employeeId === employee.id);
    if (!rate || !Array.isArray(rate.history)) throw new Error('A rental pay rate was missing. Existing earnings were preserved.');
    const history = rate.history.map(change => {
      if (!Number.isFinite(Date.parse(change.effectiveAt)) || !Number.isSafeInteger(change.revision) || change.revision <= 0) throw new Error('A rental rate change was invalid. Existing earnings were preserved.');
      return { effectiveAt: change.effectiveAt, revision: change.revision, compensation: validateRentalPay(change.compensation) };
    });
    return { ...employee, rentalPayHistory: history };
  });
}
