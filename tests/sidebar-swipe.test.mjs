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
      if (selector === '[data-slot="sidebar-wrapper"]' ? element.wrapper
        : selector.startsWith('[data-sidebar=') ? element.mobileSidebar
        : element.control || (selector.startsWith('a, button') && element.interactive)) return element;
    }
    return null;
  }
}

function fixture({ sidebarOpen = false } = {}) {
  const doc = new EventTarget();
  doc.body = new ElementFixture();
  const wrapper = new ElementFixture(doc.body, { wrapper: true });
  const target = new ElementFixture(wrapper);
  const sidebar = new ElementFixture(doc.body, { mobileSidebar: true });
  const row = new ElementFixture(sidebar, { interactive: true });
  doc.sidebar = sidebarOpen ? sidebar : null;
  doc.visibilityState = 'visible';
  doc.querySelector = () => doc.sidebar;
  doc.querySelectorAll = () => [doc.sidebar, doc.modal ? {} : null].filter(Boolean);
  doc.defaultView = {
    innerWidth: 390, Element: ElementFixture, visualViewport: { scale: 1 },
    getSelection: () => ({ isCollapsed: !doc.selectedText }),
    getComputedStyle: element => ({ overflowX: element.overflowX }),
  };
  let opened = 0, closed = 0;
  const cleanup = attachSidebarSwipe(doc, () => opened++, () => { closed++; doc.sidebar = null; });
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
  const closeSwipe = (options = {}) => {
    options = { target: row, ...options };
    send('touchstart', 240, 200, 0, options);
    const move = send('touchmove', 220, 202, 100, options);
    const end = send('touchend', 140, 205, 240, options);
    return { move, end };
  };
  const click = (detail = 1) => {
    const event = new Event('click', { cancelable: true });
    Object.defineProperty(event, 'detail', { value: detail });
    doc.dispatchEvent(event);
    return event;
  };
  return { doc, wrapper, target, sidebar, row, cleanup, send, swipe, closeSwipe, click, get opened() { return opened; }, get closed() { return closed; } };
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

test('left swipe across a navigation row closes once and suppresses its release click', () => {
  const f = fixture({ sidebarOpen: true });
  const { move, end } = f.closeSwipe();
  assert.equal(move.defaultPrevented, true);
  assert.equal(end.defaultPrevented, true);
  assert.equal(f.closed, 1);
  assert.equal(f.opened, 0);
  assert.equal(f.click().defaultPrevented, true, 'release must not navigate or click through the closing menu');
  assert.equal(f.click(0).defaultPrevented, false, 'keyboard and assistive clicks remain available');
  f.send('touchend', 140, 205, 250);
  assert.equal(f.closed, 1);
  f.send('touchstart', 200, 300, 300);
  assert.equal(f.click().defaultPrevented, false, 'a new deliberate tap works immediately');
  f.swipe();
  assert.equal(f.opened, 1, 'the same listeners can open again after closing');
  f.cleanup();
});

test('vertical scrolling, opposite swipes, long holds, and short drags do not close', () => {
  for (const points of [
    [[240, 200, 0], [238, 250, 100], [130, 252, 250]],
    [[240, 200, 0], [260, 201, 100], [130, 205, 250]],
    [[240, 200, 0], [220, 201, 100], [210, 205, 250]],
    [[240, 200, 0], [220, 201, 100], [130, 205, 1300]],
  ]) {
    const f = fixture({ sidebarOpen: true });
    ['touchstart', 'touchmove', 'touchend'].forEach((type, i) => f.send(type, ...points[i], { target: f.row }));
    assert.equal(f.closed, 0, JSON.stringify(points));
    f.cleanup();
  }
  const f = fixture({ sidebarOpen: true });
  f.send('touchstart', 240, 200, 0, { target: f.row });
  assert.equal(f.send('touchmove', 238, 250, 100, { target: f.row }).defaultPrevented, false);
  f.send('touchend', 238, 250, 250, { target: f.row });
  f.send('touchstart', 240, 200, 300, { target: f.row });
  assert.equal(f.send('touchend', 240, 200, 400, { target: f.row }).defaultPrevented, false);
  assert.equal(f.click().defaultPrevented, false, 'a normal navigation tap is untouched');
  f.send('touchstart', 240, 200, 500, { target: f.row });
  f.send('touchmove', 220, 200, 600, { target: f.row });
  f.send('touchend', 210, 200, 700, { target: f.row });
  assert.equal(f.click().defaultPrevented, true, 'a short drag must not turn into a navigation tap');
  assert.equal(f.closed, 0);
  f.cleanup();
});

test('closing preserves form controls, horizontal scrollers, and content outside the menu', () => {
  for (const makeTarget of [
    f => new ElementFixture(f.sidebar, { control: true }),
    f => new ElementFixture(new ElementFixture(f.sidebar, { overflowX: 'auto', scrollWidth: 900 })),
    f => f.target,
  ]) {
    const f = fixture({ sidebarOpen: true });
    assert.equal(f.closeSwipe({ target: makeTarget(f) }).move.defaultPrevented, false);
    assert.equal(f.closed, 0);
    f.cleanup();
  }
});

test('a nested dialog, zoom, selection, desktop, or hidden page prevents swipe dismissal', () => {
  for (const setup of [
    f => { f.doc.modal = true; },
    f => { f.doc.defaultView.visualViewport.scale = 2; },
    f => { f.doc.defaultView.innerWidth = 1024; },
    f => { f.doc.selectedText = true; },
    f => { f.doc.visibilityState = 'hidden'; },
  ]) {
    const f = fixture({ sidebarOpen: true }); setup(f);
    assert.equal(f.closeSwipe().move.defaultPrevented, false);
    assert.equal(f.closed, 0);
    f.cleanup();
  }
});

test('interrupted close swipes leave the menu open and cleanup removes click suppression', () => {
  for (const interrupt of [
    f => f.send('touchcancel', 220, 200, 120),
    f => f.send('touchmove', 210, 200, 120, { touches: [{ identifier: 1 }, { identifier: 2 }] }),
    f => f.send('touchmove', 210, 200, 120, { cancelable: false }),
    f => f.send('touchmove', 210, 200, 120, { id: 2 }),
    f => { f.doc.modal = true; },
    f => { f.doc.sidebar = null; },
  ]) {
    const f = fixture({ sidebarOpen: true });
    f.send('touchstart', 240, 200, 0, { target: f.row });
    f.send('touchmove', 220, 200, 100, { target: f.row });
    interrupt(f);
    f.send('touchend', 140, 200, 200, { target: f.row });
    assert.equal(f.closed, 0);
    f.cleanup();
    assert.equal(f.click().defaultPrevented, false);
    assert.equal(f.closeSwipe().move.defaultPrevented, false);
  }
});
