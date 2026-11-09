import { alertCategory } from "../lib/alert-presentation.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { alertTimestamp, chronologicalAlerts, groupAlerts } from '../lib/alert-presentation.mjs';

test('timeline mixes people newest first without mutating inbox order', () => {
  const alerts = [{ id: 'old', createdAt: 1, sequence: 1, title: 'Other' }, { id: 'new', createdAt: 3, sequence: 3, title: 'Other' }, { id: 'middle', createdAt: 2, sequence: 2, title: 'Other' }];
  assert.deepEqual(chronologicalAlerts(alerts).map(a => a.id), ['new', 'middle', 'old']);
  assert.equal(alerts[0].id, 'old');
  assert.deepEqual(groupAlerts(chronologicalAlerts(alerts))[0].alerts.map(a => a.id), ['new', 'middle', 'old']);
});
test('timestamps use studio calendar days and 12-hour times', () => {
  const now = Date.parse('2026-10-28T19:30:00Z');
  assert.equal(alertTimestamp(Date.parse('2026-10-28T19:15:00Z'), now), 'Today · 3:15 PM');
  assert.equal(alertTimestamp(Date.parse('2026-10-27T22:42:00Z'), now), 'Yesterday · 6:42 PM');
  assert.equal(alertTimestamp(Date.parse('2026-10-26T16:00:00Z'), now), 'Oct 26, 2026 · 12:00 PM');
  assert.equal(alertTimestamp(Date.parse('2026-10-28T02:00:00Z'), now), 'Yesterday · 10:00 PM');
});
test('yesterday works across daylight saving and year boundaries', () => {
  assert.equal(alertTimestamp(Date.parse('2026-03-08T05:30:00Z'), Date.parse('2026-03-09T04:15:00Z')), 'Yesterday · 12:30 AM');
  assert.equal(alertTimestamp(Date.parse('2025-12-31T17:00:00Z'), Date.parse('2026-01-01T17:00:00Z')), 'Yesterday · 12:00 PM');
});


test("notification categories preserve urgency while distinguishing everyday work", () => {
  assert.equal(alertCategory({ title: "Changed rental needs review", kind: "assignment", target: "scheduling" }).id, "attention");
  assert.equal(alertCategory({ title: "Rental cancelled", kind: "assignment", target: "scheduling" }).id, "cancelled");
  assert.equal(alertCategory({ title: "Offer accepted", kind: "assignment", target: "scheduling" }).id, "confirmed");
  for (const [target, category] of [["payouts", "payment"], ["availability", "availability"], ["creative", "creative"], ["quiz", "quiz"], ["scheduling", "rental"], ["alerts", "notice"]]) {
    const result = alertCategory({ title: "New update", kind: "update", target });
    assert.equal(result.id, category); assert.ok(result.label, "color is accompanied by readable category text");
  }
});
