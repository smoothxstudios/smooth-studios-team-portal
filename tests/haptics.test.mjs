import test from 'node:test';
import assert from 'node:assert/strict';
import { hapticFeedback } from '../lib/haptics.mjs';

test('feedback is optional, respects reduced motion and hidden pages, and never blocks an action', () => {
  assert.equal(hapticFeedback('success', {}), false);
  assert.equal(hapticFeedback('light', { navigator: { vibrate() { throw new Error('Unavailable'); } } }), false);
  const calls = [], env = { navigator: { vibrate: pattern => { calls.push(pattern); return true; } } };
  assert.equal(hapticFeedback('light', env), true);
  assert.equal(hapticFeedback('success', env), true);
  assert.equal(hapticFeedback('warning', { ...env, document: { visibilityState: 'hidden' } }), false);
  assert.equal(hapticFeedback('light', { ...env, matchMedia: () => ({ matches: true }) }), false);
  assert.deepEqual(calls, [10, [12, 45, 18]]);
});
