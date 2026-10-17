import { TEAM } from './team-schedule.mjs';
export function alertPerson(alert) {
  const exact = TEAM.find(person => person.id === alert.personId);
  if (exact) return exact;
  // Older inbox records identify the person in the notification heading.
  return TEAM.find(person => new RegExp(`^${person.name}(?:[’']s)?(?:\\s|$)`, 'i').test(alert.title)) ?? null;
}
export function alertBody(body) {
  return (body ?? '').replace(/\s*Open your schedule (?:to (?:view|review)(?: the details)?|for details)\.?/gi, '').trim();
}
export function groupAlerts(alerts) {
  const groups = new Map();
  for (const alert of alerts) {
    const person = alertPerson(alert), id = person?.id ?? 'general';
    if (!groups.has(id)) groups.set(id, { id, person, alerts: [] });
    groups.get(id).alerts.push(alert);
  }
  return [...groups.values()];
}
