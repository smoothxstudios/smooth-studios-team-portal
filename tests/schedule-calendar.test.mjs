import assert from "node:assert/strict";
import test from "node:test";
import { calendarDays, calendarDayLayout, calendarMonth, calendarWeek, moveCalendarMonth } from "../lib/schedule-calendar.mjs";
import { localInstant } from "../lib/team-schedule.mjs";

const entry = (id, start, end) => ({ id, kind: "work", title: "Example rental", start: localInstant(start), end: localInstant(end) });

test("full months preserve weekday positions, adjacent dates, and leap-year navigation", () => {
  const days = calendarMonth("2026-10-16");
  assert.equal(days.length, 42);
  assert.equal(days[0], "2026-09-27");
  assert.equal(days.at(-1), "2026-11-07");
  assert.equal(days.indexOf("2026-10-01") % 7, 4, "October starts on Thursday");
  assert.equal(days.indexOf("2026-10-16") % 7, 5, "the selected Friday stays in Friday's column");
  assert.equal(moveCalendarMonth("2027-01-31", 1), "2027-02-28");
  assert.equal(moveCalendarMonth("2028-01-31", 1), "2028-02-29");
  assert.equal(moveCalendarMonth("2026-12-31", 1), "2027-01-31");
  assert.equal(moveCalendarMonth("2026-01-31", -1), "2025-12-31");
});

test("week and day navigation use real calendar dates while List retains a 30-day range", () => {
  assert.deepEqual(calendarWeek("2026-10-16"), ["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"]);
  assert.deepEqual(calendarDays("2026-10-16", "day"), ["2026-10-16"]);
  assert.equal(calendarDays("2026-10-31", "list").at(-1), "2026-11-29");
  assert.equal(calendarDays("2026-11-01", "week")[0], "2026-11-01");
});

test("overlapping bookings get separate lanes and adjacent bookings can reuse a lane", () => {
  const items = [
    entry("a", "2026-10-16T09:00", "2026-10-16T11:00"),
    entry("b", "2026-10-16T09:30", "2026-10-16T10:00"),
    entry("c", "2026-10-16T10:00", "2026-10-16T12:00"),
    entry("d", "2026-10-16T12:00", "2026-10-16T13:00"),
  ];
  const layout = calendarDayLayout(items, "2026-10-16");
  const byId = Object.fromEntries(layout.map(segment => [segment.item.id, segment]));
  assert.notEqual(byId.a.column, byId.b.column);
  assert.equal(byId.b.column, byId.c.column);
  assert.equal(byId.a.columns, 2);
  assert.equal(byId.d.columns, 1, "a later independent booking gets the full column width");
  for (const a of layout) for (const b of layout) {
    if (a.item.id === b.item.id || a.column !== b.column) continue;
    assert.ok(a.displayEnd <= b.startMinute || b.displayEnd <= a.startMinute, "same-lane cards cannot cover each other");
  }
});

test("short events reserve space and coincident starts remain clickable", () => {
  const layout = calendarDayLayout([
    entry("a", "2026-10-16T12:00", "2026-10-16T12:05"),
    entry("b", "2026-10-16T12:05", "2026-10-16T12:15"),
    entry("c", "2026-10-16T12:00", "2026-10-16T13:00"),
  ], "2026-10-16");
  assert.equal(new Set(layout.map(segment => segment.column)).size, 3);
  assert.ok(layout.every(segment => segment.displayEnd - segment.startMinute >= 20));
});

test("overnight entries clip into the correct Eastern days without midnight duplicates", () => {
  const overnight = entry("night", "2026-10-31T21:00", "2026-11-01T02:00");
  const [first] = calendarDayLayout([overnight], "2026-10-31");
  const [second] = calendarDayLayout([overnight], "2026-11-01");
  assert.equal(first.startMinute, 1260);
  assert.equal(first.endMinute, 1440);
  assert.equal(first.continuesAfter, true);
  assert.equal(second.startMinute, 0);
  assert.equal(second.endMinute, 120);
  assert.equal(second.continuesBefore, true);
  assert.equal(calendarDayLayout([overnight], "2026-11-02").length, 0);
  assert.equal(calendarDayLayout([entry("midnight", "2026-10-31T23:00", "2026-11-01T00:00")], "2026-11-01").length, 0);
});

test("repeated fall-back times retain a positive span and availability uses the same clock", () => {
  const repeated = { id: "dst", kind: "work", start: "2026-11-01T01:45:00-04:00", end: "2026-11-01T01:15:00-05:00" };
  const fullDay = { ...entry("blocked", "2026-11-01T00:00", "2026-11-02T00:00"), kind: "block" };
  const layout = calendarDayLayout([repeated, fullDay], "2026-11-01");
  const short = layout.find(segment => segment.item.id === "dst");
  const block = layout.find(segment => segment.item.id === "blocked");
  assert.ok(short.endMinute > short.startMinute);
  assert.equal(block.startMinute, 0);
  assert.equal(block.endMinute, 1440);
  assert.notEqual(short.column, block.column);
});
