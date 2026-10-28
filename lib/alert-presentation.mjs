import { TEAM } from './team-schedule.mjs';
const dayStamp = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const timeStamp = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true });
const dateStamp = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
export function alertTimestamp(createdAt, now = Date.now()) {
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';
  const today = dayStamp.format(now);
  const parts = dayStamp.formatToParts(now);
  const value = name => Number(parts.find(part => part.type === name).value);
  const yesterday = dayStamp.format(Date.UTC(value('year'), value('month') - 1, value('day') - 1, 16));
  const day = dayStamp.format(date);
  return `${day === today ? 'Today' : day === yesterday ? 'Yesterday' : dateStamp.format(date)} · ${timeStamp.format(date)}`;
}
export function chronologicalAlerts(alerts) {
  return [...alerts].sort((a, b) => b.createdAt - a.createdAt || b.sequence - a.sequence);
}
export function alertPerson(alert) {
  const exact = TEAM.find(person => person.id === alert.personId);
  if (exact) return exact;
  // Older inbox records identify the person in the notification heading.
  return TEAM.find(person => new RegExp(`^${person.name}(?:[’']s)?(?:\\s|$)`, 'i').test(alert.title)) ?? null;
}
export function alertBody(body) {
  return (body ?? '').replace(/(\d{1,2}:\d{2} [AP]M) (?:EDT|EST)\b/g, '$1')
    .replace(/\s*Open your schedule (?:to (?:view|review)(?: the details)?|for details)\.?/gi, '').trim();
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
