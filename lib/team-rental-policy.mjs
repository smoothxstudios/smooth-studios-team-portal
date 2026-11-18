import { studioLocal } from './team-schedule.mjs';

export const TEAM_RENTAL_DEDUCTION_START = '2026-09-25';

export function validRentalDeductionStart(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

// Both cutoffs use the booking's start date in studio time, including overnight rentals.
/** @param {string} start @param {string | null} [teamStart] */
export function rentalDeductionDateEligible(start, teamStart = null) {
  if (!Number.isFinite(Date.parse(start)) || (teamStart !== null && !validRentalDeductionStart(teamStart))) return false;
  const date = studioLocal(start).slice(0, 10);
  return date >= TEAM_RENTAL_DEDUCTION_START && (teamStart === null || date >= teamStart);
}
