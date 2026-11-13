import { localInstant, studioLocal } from './team-schedule.mjs';

export const STUDIO_OPEN_TIME = '12:00';
export const STUDIO_CLOSE_TIME = '22:00';

export function studioDayWindow(day) {
  return { start: localInstant(`${day}T${STUDIO_OPEN_TIME}`), end: localInstant(`${day}T${STUDIO_CLOSE_TIME}`) };
}

export function withinStudioHours(period) {
  const from = Date.parse(period?.start), to = Date.parse(period?.end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return false;
  const hours = studioDayWindow(studioLocal(from).slice(0, 10));
  return from >= Date.parse(hours.start) && to <= Date.parse(hours.end);
}
