import test from 'node:test';
import assert from 'node:assert/strict';
import { helpForRole, searchHelp } from '../lib/dashboard-help.mjs';

test('help understands common natural questions, aliases and notification typos', () => {
  const cases = [
    ['How do I accept a booking?', 'accept-rental'],
    ['How do I turn on notifcations?', 'enable-alerts'],
    ['where is my paycheck', 'earnings'],
    ['how do I add my school classes', 'block-time'],
    ['FaceID is not working', 'fix-sign-in'],
    ['how do I submit my video files', 'creative-submit'],
    ['Notifications were not allowed', 'notifications-not-allowed'],
    ['how do I delete and readd the app for notifications', 'notifications-not-allowed'],
  ];
  for (const [query,id] of cases) assert.ok(searchHelp(query,false).slice(0,4).some(item=>item.id===id), query);
});
test('employees cannot discover owner procedures through search or topics', () => {
  const visible = helpForRole(false);
  assert.ok(visible.length > 15); assert.ok(visible.every(item=>item.role!=='owner'));
  assert.ok(searchHelp('adjust points reset stars',false).every(item=>item.role!=='owner'));
  assert.ok(!visible.some(item=>item.category==='Manage the studio'));
  assert.ok(searchHelp('override scheduling conflict',true).slice(0,3).some(item=>item.id==='override-conflict'));
});
test('blank searches browse the selected topic and unrelated queries have no fabricated answer', () => {
  assert.ok(searchHelp('',false,'Creative work').every(item=>item.category==='Creative work'));
  assert.deepEqual(searchHelp('zqxwvbbl',false),[]);
});
