import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { attachScrollTapGuard } from '../lib/scroll-tap-guard.mjs';

const now = Date.parse('2026-10-17T12:00:00Z');
mock.timers.enable({ apis: ['Date'], now });
test.beforeEach(() => mock.timers.setTime(now));
test.after(() => mock.timers.reset());

class TrackedTarget extends EventTarget {
  listeners = new Map();
  addEventListener(type, listener, options) {
    const key = `${type}:${Boolean(typeof options === 'boolean' ? options : options?.capture)}`;
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key).add(listener);
    super.addEventListener(type, listener, options);
  }
  removeEventListener(type, listener, options) {
    const key = `${type}:${Boolean(typeof options === 'boolean' ? options : options?.capture)}`;
    this.listeners.get(key)?.delete(listener);
    super.removeEventListener(type, listener, options);
  }
  get listenerCount() { return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0); }
}

function fixture() {
  const doc = new TrackedTarget(), root = new TrackedTarget();
  root.ownerDocument = doc;
  const cleanup = attachScrollTapGuard(root);
  let clicks = 0, pointerUps = 0;
  root.addEventListener('click', () => clicks++);
  root.addEventListener('pointerup', () => pointerUps++);
  const send = (type, options = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(event, Object.fromEntries(Object.entries({
      pointerId: 1, button: 0, isPrimary: true, pointerType: 'touch', clientX: 100, clientY: 200, detail: 1, ...options,
    }).map(([key, value]) => [key, { value }])));
    let stopped = false;
    const stop = event.stopPropagation.bind(event), immediate = event.stopImmediatePropagation.bind(event);
    event.stopPropagation = () => { stopped = true; stop(); };
    event.stopImmediatePropagation = () => { stopped = true; immediate(); };
    doc.dispatchEvent(event);
    if (!stopped && options.fromRoot !== false) root.dispatchEvent(event);
    return { event, stopped };
  };
  return { doc, root, send, cleanup, get clicks() { return clicks; }, get pointerUps() { return pointerUps; } };
}

test('ordinary taps and small finger jitter keep native activation', () => {
  const f = fixture();
  assert.equal(f.send('pointerdown').event.defaultPrevented, false);
  assert.equal(f.send('pointermove', { clientX: 107, clientY: 205 }).event.defaultPrevented, false);
  const up = f.send('pointerup', { clientX: 104, clientY: 203 });
  assert.equal(up.stopped, false); assert.equal(up.event.defaultPrevented, false);
  assert.equal(f.send('click').event.defaultPrevented, false);
  assert.equal(f.clicks, 1); assert.equal(f.pointerUps, 1); f.cleanup();
});

test('vertical and horizontal swipes suppress release activation without preventing scrolling', () => {
  for (const delta of [{ clientY: 208 }, { clientX: 108 }, { clientY: 170 }, { clientX: 70 }]) {
    const f = fixture(); f.send('pointerdown');
    const move = f.send('pointermove', { ...delta, fromRoot: false });
    assert.equal(move.stopped, false); assert.equal(move.event.defaultPrevented, false);
    const up = f.send('pointerup', delta);
    assert.equal(up.stopped, true); assert.equal(up.event.defaultPrevented, false);
    assert.equal(f.pointerUps, 0, 'Radix pointerup cannot synthesize its detail-0 click');
    assert.equal(f.send('click').event.defaultPrevented, true); assert.equal(f.clicks, 0); f.cleanup();
  }
});

test('fast swipes use final displacement even without a pointermove event', () => {
  const f = fixture(); f.send('pointerdown');
  const up = f.send('pointerup', { clientY: 240 });
  assert.equal(up.stopped, true); assert.equal(up.event.defaultPrevented, false);
  assert.equal(f.send('click').event.defaultPrevented, true); f.cleanup();
});

test('actual scrolling and pointer cancellation both arm suppression', () => {
  for (const type of ['scroll', 'pointercancel']) {
    const f = fixture(); f.send('pointerdown');
    const interrupt = f.send(type, { fromRoot: false });
    assert.equal(interrupt.stopped, false); assert.equal(interrupt.event.defaultPrevented, false);
    assert.equal(f.send('pointerup').stopped, type === 'scroll');
    assert.equal(f.send('click').event.defaultPrevented, true); f.cleanup();
  }
});

test('a cancelled pointer releases document tracking and unrelated later scrolling cannot prolong suppression', () => {
  const f = fixture(); f.send('pointerdown'); f.send('pointercancel', { fromRoot: false });
  assert.equal(f.send('click').event.defaultPrevented, true);
  mock.timers.setTime(now + 650);
  f.send('scroll', { fromRoot: false });
  const unrelatedUp = f.send('pointerup', { clientY: 400, fromRoot: false });
  assert.equal(unrelatedUp.stopped, false); assert.equal(unrelatedUp.event.defaultPrevented, false);
  mock.timers.setTime(now + 701);
  assert.equal(f.send('click').event.defaultPrevented, false);
  f.send('scroll', { fromRoot: false });
  assert.equal(f.send('click').event.defaultPrevented, false); f.cleanup();
});

test('unrelated pointer moves and releases stay available, while a second finger cancels the primary tap', () => {
  const f = fixture(); f.send('pointerdown');
  f.send('pointermove', { pointerId: 2, clientY: 300, fromRoot: false });
  assert.equal(f.send('pointercancel', { pointerId: 2, fromRoot: false }).stopped, false);
  assert.equal(f.send('pointerup', { pointerId: 2, clientY: 300, fromRoot: false }).stopped, false);
  assert.equal(f.send('pointerup').stopped, false); assert.equal(f.send('click').event.defaultPrevented, false);
  f.send('pointerdown');
  f.send('pointerdown', { pointerId: 2, isPrimary: false, fromRoot: false });
  assert.equal(f.send('pointerup', { pointerId: 2, isPrimary: false, fromRoot: false }).stopped, false);
  assert.equal(f.send('pointerup').stopped, true); assert.equal(f.send('click').event.defaultPrevented, true); f.cleanup();
});

test('fresh taps, keyboard and assistive activation remain usable and suppression expires', () => {
  const f = fixture();
  const swipe = () => { f.send('pointerdown'); f.send('pointerup', { clientY: 240 }); };
  swipe(); assert.equal(f.send('click', { detail: 0 }).event.defaultPrevented, false);
  mock.timers.setTime(now + 699); assert.equal(f.send('click').event.defaultPrevented, true);
  mock.timers.setTime(now + 701); assert.equal(f.send('click').event.defaultPrevented, false);
  swipe(); f.send('pointerdown'); assert.equal(f.send('pointerup').stopped, false);
  assert.equal(f.send('click').event.defaultPrevented, false); f.cleanup();
});

test('cleanup removes every guard listener and clears a gesture in progress', () => {
  const f = fixture(); assert.equal(f.doc.listenerCount, 5); assert.equal(f.root.listenerCount, 4);
  f.send('pointerdown'); f.send('pointermove', { clientY: 240 }); f.cleanup();
  assert.equal(f.doc.listenerCount, 0); assert.equal(f.root.listenerCount, 2);
  assert.equal(f.send('pointerup', { clientY: 240 }).stopped, false);
  assert.equal(f.send('click').event.defaultPrevented, false);
  f.send('pointerdown'); f.send('pointermove', { clientY: 240 });
  assert.equal(f.send('pointerup', { clientY: 240 }).stopped, false); f.cleanup();
});
