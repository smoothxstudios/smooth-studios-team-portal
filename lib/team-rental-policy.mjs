import { studioLocal } from './team-schedule.mjs';

export const TEAM_RENTAL_DEDUCTION_START = '2026-09-25';

// The booking's start date in studio time owns the cutoff, including overnight rentals.
export function rentalDeductionDateEligible(start) {
  return Number.isFinite(Date.parse(start)) && studioLocal(start).slice(0, 10) >= TEAM_RENTAL_DEDUCTION_START;
}
