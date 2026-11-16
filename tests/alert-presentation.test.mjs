import { alertCategory, alertTitle } from "../lib/alert-presentation.mjs";
import { assignmentNotifications } from "../team-api/notification-content.mjs";
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

test('saved standalone task alerts display as shifts without changing rental or creative alerts', () => {
  const saved = { id: 'existing-alert', target: 'scheduling', kind: 'assignment', title: 'New task assignment', readAt: 123 };
  assert.equal(alertTitle(saved), 'New shift');
  assert.deepEqual(alertCategory(saved), { id: 'shift', label: 'Shift' });
  assert.equal(saved.title, 'New task assignment');
  assert.equal(saved.readAt, 123);
  assert.equal(alertTitle({ ...saved, title: 'Task assignment cancelled' }), 'Shift cancelled');
  assert.equal(alertTitle({ ...saved, title: 'Jordyn accepted a task' }), 'Jordyn accepted a shift');
  assert.equal(alertTitle({ ...saved, title: 'Jordyn’s task time changed' }), 'Jordyn’s shift time changed');
  assert.equal(alertTitle({ ...saved, target: 'creative' }), 'New task assignment');
  assert.equal(alertCategory({ ...saved, title: 'New rental assignment' }).id, 'rental');
  assert.equal(alertCategory({ ...saved, kind: 'notice', title: 'Shift response reminder' }).id, 'shift');
});

test('shift notifications keep their destination and never use rental or assignment wording', () => {
  const item = { id: 'shift-id', employeeId: 'jordyn', appointmentId: null, title: 'Organize equipment', start: '2026-11-17T17:00:00Z', end: '2026-11-17T19:00:00Z' };
  for (const event of ['offered', 'accepted', 'declined', 'cancelled', 'conflict', 'rescheduled']) {
    const alerts = assignmentNotifications(item, event, ['owner', 'jordyn']);
    for (const alert of alerts) {
      assert.equal(alert.kind, 'shift');
      assert.equal(alert.target, 'scheduling');
      assert.equal(alert.targetId, item.id);
      assert.match(alert.title, /shift/i);
      assert.doesNotMatch(alert.title.toLowerCase(), /rental|assignment|task/);
      assert.notEqual(alertCategory(alert).id, 'rental');
    }
  }
  const rental = assignmentNotifications({ ...item, appointmentId: 'rental-id' }, 'offered', ['jordyn'])[0];
  assert.equal(rental.title, 'New rental assignment');
  assert.equal(rental.kind, 'assignment');
  assert.equal(alertCategory(rental).id, 'rental');
});
