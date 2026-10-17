import assert from 'node:assert/strict';
import test from 'node:test';
import { createNotificationDraft } from '../lib/team-notification-draft.mjs';

const draft = { recipientIds: ['akiva', 'jordyn'], title: 'Schedule reminder', body: 'Check your upcoming assignments.', target: 'scheduling' };
function fixture() {
  let count = 0;
  return { request: createNotificationDraft(() => `00000000-0000-4000-8000-${String(++count).padStart(12, '0')}`), get count() { return count; } };
}

test('an unchanged notification retains its send ID across an uncertain response and a retry', () => {
  const f = fixture();
  const first = f.request.prepare(draft);
  const retry = f.request.prepare({ ...draft, recipientIds: ['jordyn', 'akiva', 'akiva'], title: ` ${draft.title} `, body: `${draft.body} ` });
  assert.deepEqual(retry, first, 'recipient ordering and surrounding whitespace do not turn a retry into a second send');
  assert.equal(f.count, 1);
});

test('changing a recipient, message, heading, or destination starts a new send intent', () => {
  for (const change of [{ recipientIds: ['akiva'] }, { title: 'Updated schedule reminder' }, { body: 'Check the revised schedule.' }, { target: 'settings' }]) {
    const f = fixture(), first = f.request.prepare(draft), edited = f.request.prepare({ ...draft, ...change });
    assert.notEqual(edited.id, first.id); assert.equal(f.count, 2);
    assert.equal(f.request.prepare({ ...draft, ...change }).id, edited.id, 'retrying the changed content reuses its new ID');
  }
});

test('a confirmed send can be cleared so a deliberate later repeat gets its own ID', () => {
  const f = fixture(), first = f.request.prepare(draft);
  f.request.clear();
  assert.notEqual(f.request.prepare(draft).id, first.id);
});

test('invalid recipients, empty content, oversized text and unsupported destinations never create send IDs', () => {
  for (const change of [{ recipientIds: [] }, { recipientIds: ['owner'] }, { recipientIds: ['unknown'] }, { title: ' ' }, { body: '' }, { title: 'a'.repeat(81) }, { body: 'a'.repeat(361) }, { target: 'https://example.invalid' }]) {
    const f = fixture(); assert.throws(() => f.request.prepare({ ...draft, ...change })); assert.equal(f.count, 0);
  }
});

test('rental context stays pinned across retries and a different booking starts a new send intent', () => {
  const f = fixture(), context = { type: 'rental', appointmentId: 'rental-a', start: '2026-12-20T14:00Z', end: '2026-12-20T15:00Z' };
  const first = f.request.prepare({ ...draft, context });
  const retry = f.request.prepare({ ...draft, context: { ...context, start: '2026-12-20T14:00:00.000Z', end: '2026-12-20T15:00:00.000Z' } });
  assert.deepEqual(retry, first);
  context.appointmentId = 'rental-b';
  assert.equal(first.context.appointmentId, 'rental-a', 'later selection edits do not mutate an uncertain request');
  assert.notEqual(f.request.prepare({ ...draft, context }).id, first.id);
});

test('availability destinations work while malformed rental context is rejected before allocating an ID', () => {
  const f = fixture();
  assert.equal(f.request.prepare({ ...draft, target: 'availability' }).target, 'availability');
  for (const context of [{ type: 'other' }, { type: 'rental', appointmentId: '', start: 'bad', end: 'bad' },
    { type: 'rental', appointmentId: 'rental-a', start: '2026-12-20T15:00Z', end: '2026-12-20T14:00Z' }]) {
    const invalid = fixture(); assert.throws(() => invalid.request.prepare({ ...draft, context })); assert.equal(invalid.count, 0);
  }
});
