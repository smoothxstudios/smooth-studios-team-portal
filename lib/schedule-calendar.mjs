import { addLocalDays, localInstant, overlaps, studioLocal } from "./team-schedule.mjs";

// Calendar views use Sunday-first weeks, matching the studio's Google Calendar.
export function calendarWeek(day) {
  const start = addLocalDays(`${day}T00:00`, -new Date(`${day}T12:00Z`).getUTCDay());
  return Array.from({ length: 7 }, (_, index) => addLocalDays(start, index).slice(0, 10));
}

export function calendarMonth(day) {
  const start = calendarWeek(`${day.slice(0, 7)}-01`)[0];
  return Array.from({ length: 42 }, (_, index) => addLocalDays(`${start}T00:00`, index).slice(0, 10));
}

export function moveCalendarMonth(day, offset) {
  const date = new Date(`${day.slice(0, 7)}-01T12:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  return `${date.toISOString().slice(0, 7)}-${String(Math.min(Number(day.slice(-2)), lastDay)).padStart(2, "0")}`;
}

export function calendarDays(day, view) {
  if (view === "month") return calendarMonth(day);
  if (view === "week") return calendarWeek(day);
  return Array.from({ length: view === "list" ? 30 : 1 }, (_, index) => addLocalDays(`${day}T00:00`, index).slice(0, 10));
}

const wallMinute = instant => {
  const local = studioLocal(instant);
  return Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16));
};

/** Clip overnight entries to each Eastern day and give overlapping events
 * separate lanes. Short events reserve a 24px target in the 72px/hour grid. */
export function calendarDayLayout(entries, day) {
  const start = localInstant(`${day}T00:00`), end = localInstant(addLocalDays(`${day}T00:00`, 1));
  const startMs = Date.parse(start), endMs = Date.parse(end);
  const segments = entries.filter(item => overlaps(item, { start, end })).map(item => {
    const from = Math.max(startMs, Date.parse(item.start)), to = Math.min(endMs, Date.parse(item.end));
    const startMinute = from === startMs ? 0 : wallMinute(from);
    let endMinute = to === endMs ? 1440 : wallMinute(to);
    // During the repeated fall-back hour, clock labels can run backwards.
    // Keep a positive visible span; the details retain the exact timestamps.
    if (endMinute <= startMinute) endMinute = Math.min(1440, startMinute + (to - from) / 60_000);
    const displayEnd = Math.min(1440, Math.max(endMinute, startMinute + 20));
    return { item, startMinute, endMinute, displayEnd, column: 0, columns: 1,
      continuesBefore: Date.parse(item.start) < startMs, continuesAfter: Date.parse(item.end) > endMs };
  }).sort((a, b) => a.startMinute - b.startMinute || b.displayEnd - a.displayEnd || a.item.id.localeCompare(b.item.id));
  let group = [], groupEnd = -1;
  function finishGroup() {
    const columnEnds = [];
    for (const segment of group) {
      let column = columnEnds.findIndex(end => end <= segment.startMinute);
      if (column < 0) column = columnEnds.length;
      columnEnds[column] = segment.displayEnd;
      segment.column = column;
    }
    for (const segment of group) segment.columns = columnEnds.length;
    group = [];
  }
  for (const segment of segments) {
    if (segment.startMinute >= groupEnd) finishGroup();
    group.push(segment);
    groupEnd = Math.max(groupEnd, segment.displayEnd);
  }
  finishGroup();
  return segments;
}
