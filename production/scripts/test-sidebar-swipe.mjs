import test from 'node:test';
import assert from 'node:assert/strict';
import { attachSidebarSwipe } from '../lib/sidebar-swipe.mjs';

// Minimal event/DOM fixture: dispatch the real listener lifecycle without a browser.
class ElementFixture {
  constructor(parentElement = null, flags = {}) {
    Object.assign(this, { parentElement, clientWidth: 390, scrollWidth: 390, overflowX: 'visible' }, flags);
  }
  closest(selector) {
    for (let element = this; element; element = element.parentElement) {
      if (selector === '[data-slot="sidebar-wrapper"]' ? element.wrapper : element.interactive) return element;
    }
    return null;
  }
}

function fixture() {
  const doc = new EventTarget();
  doc.body = new ElementFixture();
  const wrapper = new ElementFixture(doc.body, { wrapper: true });
  const target = new ElementFixture(wrapper);
  doc.visibilityState = 'visible';
  doc.querySelector = () => doc.modal ? {} : null;
  doc.defaultView = {
    innerWidth: 390, Element: ElementFixture, visualViewport: { scale: 1 },
    getSelection: () => ({ isCollapsed: !doc.selectedText }),
    getComputedStyle: element => ({ overflowX: element.overflowX }),
  };
  let opened = 0;
  const cleanup = attachSidebarSwipe(doc, () => opened++);
  const send = (type, x = 24, y = 200, at = 0, options = {}) => {
    const event = new Event(type, { cancelable: options.cancelable ?? true });
    const point = { identifier: options.id ?? 1, clientX: x, clientY: y };
    Object.defineProperties(event, {
      target: { value: options.target ?? target }, timeStamp: { value: at },
      touches: { value: options.touches ?? (type === 'touchend' || type === 'touchcancel' ? [] : [point]) },
      changedTouches: { value: [point] },
    });
    doc.dispatchEvent(event);
    return event;
  };
  const swipe = (options = {}) => {
    send('touchstart', 24, 200, 0, options);
    const move = send('touchmove', 40, 202, 100, options);
    const end = send('touchend', 108, 205, 240, options);
    return { move, end };
  };
  return { doc, wrapper, target, cleanup, send, swipe, get opened() { return opened; } };
}

test('a right swipe near the left edge opens once and consumes only the horizontal gesture', () => {
  const f = fixture();
  const { move, end } = f.swipe();
  assert.equal(f.opened, 1);
  assert.equal(move.defaultPrevented, true);
  assert.equal(end.defaultPrevented, true);
  f.send('touchend', 108, 205, 250);
  assert.equal(f.opened, 1);
  f.cleanup();
  assert.equal(f.swipe().move.defaultPrevented, false);
  assert.equal(f.opened, 1, 'unmount/desktop/sidebar-open cleanup removes listeners');
});

test('vertical scrolling, left swipes, short drags, slow gestures and central-page swipes do not open', () => {
  const sequences = [
    [[24, 200, 0], [28, 240, 100], [120, 245, 250]], // vertical first, then right
    [[24, 200, 0], [10, 200, 100], [120, 200, 250]], // left first, then right
    [[24, 200, 0], [40, 200, 100], [55, 200, 250]], // too short
    [[24, 200, 0], [40, 200, 100], [110, 200, 1300]], // long hold
    [[160, 200, 0], [190, 200, 100], [260, 200, 250]], // away from edge
  ];
  for (const points of sequences) {
    const f = fixture();
    ['touchstart', 'touchmove', 'touchend'].forEach((type, i) => f.send(type, ...points[i]));
    assert.equal(f.opened, 0, JSON.stringify(points));
    f.cleanup();
  }
  const f = fixture();
  f.send('touchstart');
  assert.equal(f.send('touchmove', 26, 245, 100).defaultPrevented, false);
  f.send('touchend', 26, 245, 200);
  f.send('touchstart');
  assert.equal(f.send('touchend', 24, 200, 100).defaultPrevented, false, 'a tap is untouched');
  assert.equal(f.opened, 0);
  f.cleanup();
});

test('form controls, outside content and nested horizontal scrolling keep their own interactions', () => {
  for (const makeTarget of [
    f => new ElementFixture(new ElementFixture(f.wrapper, { interactive: true })),
    f => new ElementFixture(new ElementFixture(f.wrapper, { overflowX: 'auto', scrollWidth: 900 })),
    f => new ElementFixture(f.doc.body),
  ]) {
    const f = fixture();
    assert.equal(f.swipe({ target: makeTarget(f) }).move.defaultPrevented, false);
    assert.equal(f.opened, 0);
    f.cleanup();
  }
});

test('pinch zoom, desktop, text selection and open dialogs disable opening', () => {
  for (const setup of [
    f => { f.doc.defaultView.visualViewport.scale = 2; },
    f => { f.doc.defaultView.innerWidth = 1024; },
    f => { f.doc.selectedText = true; },
    f => { f.doc.modal = true; },
    f => { f.doc.visibilityState = 'hidden'; },
  ]) {
    const f = fixture(); setup(f);
    assert.equal(f.swipe().move.defaultPrevented, false);
    assert.equal(f.opened, 0);
    f.cleanup();
  }
  const f = fixture();
  f.send('touchstart'); f.send('touchmove', 50, 200, 100);
  f.doc.modal = true;
  f.send('touchend', 120, 200, 200);
  assert.equal(f.opened, 0, 'a dialog opened mid-gesture takes precedence');
  f.cleanup();
});

test('cancelled, multi-touch and browser-owned gestures reset without opening', () => {
  for (const interrupt of [
    f => f.send('touchcancel', 50, 200, 120),
    f => f.send('touchstart', 50, 200, 120, { touches: [{ identifier: 1 }, { identifier: 2 }] }),
    f => f.send('touchmove', 60, 200, 120, { cancelable: false }),
    f => f.send('touchmove', 60, 200, 120, { id: 2 }),
  ]) {
    const f = fixture();
    f.send('touchstart'); f.send('touchmove', 50, 200, 100); interrupt(f);
    f.send('touchend', 120, 200, 200);
    assert.equal(f.opened, 0);
    f.swipe();
    assert.equal(f.opened, 1, 'the next valid swipe still works');
    f.cleanup();
  }
});
