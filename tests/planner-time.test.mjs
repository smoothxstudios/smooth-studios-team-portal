import test from 'node:test';
import assert from 'node:assert/strict';
import { plannerTimeText } from '../lib/planner-time.mjs';

test('saved crew availability descriptions display 12-hour times', () => {
  assert.equal(plannerTimeText('Availability starts at 18:05.'), 'Availability starts at 6:05 PM.');
  assert.equal(plannerTimeText('Unavailable all day: 00:00–00:00'), 'Unavailable all day: 12:00 AM–12:00 AM');
  assert.equal(plannerTimeText('09:00-12:00, then 23:30.'), '9:00 AM-12:00 PM, then 11:30 PM.');
  const unchanged = '6:05 PM, 12:00 am, 6:30 p.m., 2026-10-19T18:05, 18:05:30, https://example.test/?time=18:05';
  assert.equal(plannerTimeText(unchanged), unchanged);
});
