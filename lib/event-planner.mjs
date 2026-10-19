import { TEAM, localInstant, studioLocal, addLocalDays, blockOccurrences, overlaps, workPreferenceMatch } from './team-schedule.mjs';

export const emptyPlan = () => ({ events: [], guests: [], availability: [] });
export const plannerPeople = plan => [...TEAM.map(p => ({ ...p, guest: false })), ...plan.guests.map(p => ({ ...p, guest: true, color: '#64748b' }))];
const value = (v, max, required = false) => {
  if (typeof v !== 'string' || v.length > max || (required && !v.trim())) throw new Error('Check the required fields and text length.');
  return v.trim();
};
const idValue = v => { if (typeof v !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(v)) throw new Error('Invalid plan item.'); return v; };
function period(start, end = '') {
  localInstant(start);
  if (end && (Date.parse(localInstant(end)) <= Date.parse(localInstant(start)) || Date.parse(localInstant(end)) - Date.parse(localInstant(start)) > 7 * 86400000)) throw new Error('End must follow start, within seven days.');
}
function unique(items) { if (new Set(items.map(p => p.id)).size !== items.length) throw new Error('Duplicate plan item.'); return items; }
export function validatePlan(input) {
  if (!input || !Array.isArray(input.events) || input.events.length > 300 || !Array.isArray(input.guests) || input.guests.length > 40 || !Array.isArray(input.availability) || input.availability.length > 600) throw new Error('Choose a valid saved plan (up to 300 events).');
  const guests = unique(input.guests.map(p => ({ id: idValue(p.id), name: value(p.name, 60, true) })));
  if (guests.some(p => TEAM.some(t => t.id === p.id))) throw new Error('A guest cannot replace a dashboard account.');
  const ids = new Set([...TEAM, ...guests].map(p => p.id));
  const events = unique(input.events.map(e => {
    const item = { id: idValue(e.id), title: value(e.title, 160, true), startLocal: value(e.startLocal,16,true), endLocal: value(e.endLocal ?? '',16),
      location: value(e.location ?? '',240), notes: value(e.notes ?? '',1500), crewNeeded: e.crewNeeded,
      coverageStartLocal: value(e.coverageStartLocal ?? '',16), coverageEndLocal: value(e.coverageEndLocal ?? '',16),
      people: Array.isArray(e.people) ? [...e.people] : [], archived: e.archived === true };
    period(item.startLocal, item.endLocal);
    period(item.coverageStartLocal || item.startLocal, item.coverageEndLocal || item.endLocal);
    if ((!Number.isSafeInteger(item.crewNeeded) || item.crewNeeded < 0) || item.people.length > item.crewNeeded || new Set(item.people).size !== item.people.length || item.people.some(p => !ids.has(p))) throw new Error('Enter a whole-number crew size that fits the selected people, or leave it undecided with nobody selected. Choose each person only once.');
    return item;
  }));
  const availability = unique(input.availability.map(a => {
    const item = { id: idValue(a.id), personId: value(a.personId,100,true), startLocal: value(a.startLocal,16,true), endLocal: value(a.endLocal,16,true), status: a.status, note: value(a.note ?? '',500) };
    period(item.startLocal,item.endLocal);
    if (!ids.has(item.personId) || !['available','unavailable','tentative'].includes(item.status)) throw new Error('Choose a person and availability status.');
    return item;
  }));
  return { events, guests, availability };
}
export function mergePlan(current, incoming) {
  const merge = (a,b) => [...new Map([...b,...a].map(p => [p.id,p])).values()];
  return validatePlan({ events: merge(current.events,incoming.events), guests: merge(current.guests,incoming.guests), availability: merge(current.availability,incoming.availability) });
}
export function eventPeriod(event) {
  const start = localInstant(event.coverageStartLocal || event.startLocal);
  const finish = event.coverageEndLocal || event.endLocal;
  return { start, end: finish ? localInstant(finish) : new Date(Date.parse(start)+1).toISOString(), unknownEnd: !finish };
}
// Group work cards by their starting studio date; availability still spans days.
export function plannerStartsOnDay(item, day) {
  return (item.startLocal || studioLocal(item.start)).slice(0,10) === day;
}
export function plannerOnDay(item, day) {
  const start = item.startLocal ? localInstant(item.startLocal) : item.start;
  const end = item.endLocal ? localInstant(item.endLocal) : item.end || new Date(Date.parse(start)+1).toISOString();
  return overlaps({start,end},{start:localInstant(`${day}T00:00`),end:localInstant(addLocalDays(`${day}T00:00`,1))});
}
export function crewFit(personId, event, plan, schedule) {
  const p = eventPeriod(event), blocked = [], cautions = [], commitments = [];
  for (const b of (schedule.blocks || []).filter(b => b.userId === personId)) {
    const hits = blockOccurrences(b,p.start,p.end);
    if (hits.length) blocked.push(`${b.reason || 'Unavailable'}: ${hits.map(h => `${studioLocal(h.start).slice(11)}-${studioLocal(h.end).slice(11)}`).join(', ')}`);
  }
  const active = (schedule.assignments || []).filter(a => a.employeeId === personId && ['accepted','pending'].includes(a.status));
  for (const a of active) if (overlaps(p,a)) { blocked.push(`${a.status === 'pending' ? 'Pending offer' : 'Assigned'}: ${a.title}`); commitments.push(a.title); }
  for (const a of schedule.appointments || []) {
    if ((a.acceptedEmployeeIds || []).includes(personId) && overlaps(p,a) && !active.some(t => t.appointmentId === a.id)) { blocked.push(`Calendar: ${a.title}`); commitments.push(a.title); }
    else if ((a.calendarInvitations || []).some(i => i.employeeId === personId && ['tentative','needsAction'].includes(i.status)) && overlaps(p,a)) cautions.push(`Calendar invitation awaiting confirmation: ${a.title}`);
  }
  for (const other of plan.events.filter(e => e.id !== event.id && !e.archived && e.people.includes(personId))) {
    const o = eventPeriod(other);
    if (!o.unknownEnd && overlaps(p,o)) blocked.push(`Planned: ${other.title}`);
    else if ((o.unknownEnd && Date.parse(o.start) < Date.parse(p.end)) || (p.unknownEnd && Date.parse(o.end) > Date.parse(p.start))) cautions.push(`Check overlap with ${other.title}; an end time is missing.`);
  }
  const notes = plan.availability.filter(a => a.personId === personId && overlaps(p,{start:localInstant(a.startLocal),end:localInstant(a.endLocal)}));
  for (const a of notes) {
    if (a.status === 'unavailable') blocked.push(a.note || 'Unavailable in this time window');
    if (a.status === 'tentative') cautions.push(a.note || 'Availability needs confirmation');
  }
  const positive = notes.filter(a => a.status === 'available').map(a => ({...a,userId:personId,repeatUntil:null}));
  const match = workPreferenceMatch(personId,p,[...(schedule.workPreferences || []),...positive]);
  if (match === 'partial') cautions.push('Only part of this coverage window is available.');
  if (p.unknownEnd) cautions.push('End time is unknown; availability is checked at the start only.');
  const status = blocked.length ? 'blocked' : cautions.length ? 'check' : match === 'full' ? 'available' : personId === 'owner' ? 'flexible' : 'unknown';
  return {status, label: status === 'blocked' ? 'Conflict' : status === 'available' ? 'Available' : status === 'flexible' ? 'Flexible' : status === 'check' ? 'Check details' : 'Availability unknown',
    reasons:[...new Set([...blocked,...cautions,...(!blocked.length && !cautions.length && match === 'none' ? [personId === 'owner' ? 'Flexible schedule. Add yourself when you plan to attend.' : 'No available hours recorded for this time.'] : [])])], commitments, availableAtStart: (match === 'full' || personId === 'owner') && !blocked.length };
}
