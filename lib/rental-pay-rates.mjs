import { studioLocal } from './team-schedule.mjs';

/** @typedef {{type: 'hourly', hourlyCents: number} | {type: 'commission', rate: number}} RentalPay */
/** Money is stored in cents; percentages are limited to two decimal places.
 * @returns {RentalPay}
 */
export function validateRentalPay(value) {
  if (value?.type === 'hourly' && Number.isSafeInteger(value.hourlyCents) && value.hourlyCents >= 100 && value.hourlyCents <= 100000)
    return { type: 'hourly', hourlyCents: value.hourlyCents };
  if (value?.type === 'commission' && Number.isFinite(value.rate) && value.rate > 0 && value.rate <= 1 && Math.abs(value.rate * 10000 - Math.round(value.rate * 10000)) < 1e-7)
    return { type: 'commission', rate: Math.round(value.rate * 10000) / 10000 };
  throw new Error('Enter $1–$1,000 per hour or a percentage above 0 and up to 100, with at most two decimal places.');
}

export function rentalPayInput(type, amount) {
  if (typeof amount !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(amount.trim())) throw new Error('Enter a positive amount with at most two decimal places.');
  const number = Number(amount);
  return validateRentalPay(type === 'hourly' ? { type, hourlyCents: Math.round(number * 100) } : { type, rate: number / 100 });
}

export function sameRentalPay(a, b) {
  return a?.type === b?.type && (a?.type === 'hourly' ? a.hourlyCents === b.hourlyCents : a?.type === 'commission' ? a.rate === b.rate : a?.type === 'pending');
}

/** Keep legacy dated commission rules, then apply owner changes by exact start. */
export function rentalPayAt(employee, config, instant, includeChanges = true) {
  const date = studioLocal(instant).slice(0, 10);
  let compensation = employee.compensation;
  if (!compensation || compensation.type === 'commission') {
    let rate = employee.commissionRate ?? compensation?.rate ?? config.commissionRate;
    for (const change of [...(employee.commissionHistory ?? [])].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))) {
      if (change.effectiveFrom <= date) rate = change.rate;
    }
    compensation = { type: 'commission', rate };
  }
  if (includeChanges) {
    const at = new Date(instant).getTime();
    for (const change of [...(employee.rentalPayHistory ?? [])].sort((a, b) => Date.parse(a.effectiveAt) - Date.parse(b.effectiveAt) || a.revision - b.revision)) {
      if (Date.parse(change.effectiveAt) <= at) compensation = change.compensation;
    }
  }
  return compensation;
}
