import test from 'node:test';
import assert from 'node:assert/strict';
import { attachPullToRefresh, PULL_REFRESH_THRESHOLD } from '../lib/pull-to-refresh.mjs';

class ElementFixture {
  constructor(parentElement, flags = {}) {
    Object.assign(this, { parentElement, clientWidth: 390, scrollWidth: 390, clientHeight: 100, scrollHeight: 100, overflowX: 'visible', overflowY: 'visible' }, flags);
  }
  closest() { return this.interactive ? this : null; }
}
function fixture() {
  const doc = new EventTarget(), win = new EventTarget(), root = new EventTarget();
  Object.assign(win, { innerWidth: 390, scrollY: 0, Element: ElementFixture, visualViewport: { scale: 1 },
    getSelection: () => ({ isCollapsed: !doc.selectedText }), getComputedStyle: element => element });
  Object.assign(doc, { defaultView: win, visibilityState: 'visible', querySelector: () => doc.modal ? {} : null });
  root.ownerDocument = doc;
  const target = new ElementFixture(root);
  let distance = 0, releases = 0, busy = false, blocked = false;
  const cleanup = attachPullToRefresh(root, { onPull: value => { distance = value; }, onRelease: () => releases++, isBusy: () => busy, isBlocked: () => blocked });
  const send = (type, x = 150, y = 200, options = {}) => {
    const event = new Event(type, { cancelable: options.cancelable ?? true });
    const point = { identifier: options.id ?? 1, clientX: x, clientY: y };
    Object.defineProperties(event, { target: { value: options.target ?? target },
      touches: { value: options.touches ?? (['touchend', 'touchcancel'].includes(type) ? [] : [point]) },
      changedTouches: { value: [point] } });
    if (options.prevented) event.preventDefault();
    root.dispatchEvent(event); return event;
  };
  const pull = () => { send('touchstart'); return send('touchmove', 152, 400); };
  return { doc, win, root, target, send, pull, cleanup, setBusy: value => { busy = value; }, setBlocked: value => { blocked = value; },
    get distance() { return distance; }, get releases() { return releases; } };
}

test('pull tracks resisted movement and refreshes once after releasing past the threshold', () => {
  const f = fixture(); assert.equal(f.pull().defaultPrevented, true);
  assert.ok(f.distance > PULL_REFRESH_THRESHOLD && f.distance < 96); assert.equal(f.releases, 0);
  f.send('touchend', 152, 400); f.send('touchend', 152, 400); assert.equal(f.releases, 1);
  f.setBusy(true); assert.equal(f.pull().defaultPrevented, false); f.send('touchend', 152, 400); assert.equal(f.releases, 1);
  f.cleanup();
});

test('short pulls and pulling back below the threshold cancel', () => {
  const f = fixture(); f.send('touchstart'); f.send('touchmove', 150, 250); f.send('touchend', 150, 250);
  assert.equal(f.releases, 0); assert.equal(f.distance, 0);
  f.pull(); f.send('touchmove', 150, 240); f.send('touchend', 150, 240);
  assert.equal(f.releases, 0); assert.equal(f.distance, 0); f.cleanup();
});

test('horizontal and upward intentions stay native even if direction later changes', () => {
  for (const [x, y] of [[180, 202], [152, 160]]) {
    const f = fixture(); f.send('touchstart'); assert.equal(f.send('touchmove', x, y).defaultPrevented, false);
    assert.equal(f.send('touchmove', 150, 420).defaultPrevented, false); f.send('touchend', 150, 420);
    assert.equal(f.releases, 0); f.cleanup();
  }
});

test('scrolled pages, forms, nested scrollers, desktop, zoom, menus and dialogs never intercept a pull', () => {
  for (const prepare of [
    f => { f.win.scrollY = 100; }, f => { f.target.interactive = true; },
    f => { f.doc.activeElement = { matches: () => true }; },
    f => { f.target.scrollHeight = 300; f.target.overflowY = 'auto'; },
    f => { f.target.scrollWidth = 700; f.target.overflowX = 'scroll'; },
    f => { f.win.innerWidth = 1024; }, f => { f.win.visualViewport.scale = 2; },
    f => { f.doc.modal = true; }, f => { f.doc.selectedText = true; }, f => f.setBlocked(true),
  ]) {
    const f = fixture(); prepare(f); assert.equal(f.pull().defaultPrevented, false);
    f.send('touchend', 152, 400); assert.equal(f.releases, 0); f.cleanup();
  }
});

test('cancel, extra fingers, non-cancelable scrolling, a new modal, resize and cleanup disarm', () => {
  for (const interrupt of [
    f => f.send('touchcancel'), f => f.send('touchmove', 152, 420, { touches: [{}, {}] }),
    f => f.send('touchmove', 152, 420, { cancelable: false }),
    f => { f.doc.modal = true; f.send('touchmove', 152, 420); },
    f => f.win.dispatchEvent(new Event('resize')), f => f.cleanup(),
  ]) {
    const f = fixture(); f.pull(); interrupt(f); f.send('touchend', 152, 400);
    assert.equal(f.releases, 0); assert.equal(f.distance, 0); f.cleanup();
  }
});
