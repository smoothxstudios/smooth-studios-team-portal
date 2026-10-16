import test from 'node:test';
import assert from 'node:assert/strict';
import { attachToolbarSlide, mobileToolbarItems } from '../lib/mobile-toolbar.mjs';

function fixture() {
  const win = new EventTarget();
  win.innerWidth = 390; win.visualViewport = { scale: 1 };
  const nav = new EventTarget();
  nav.ownerDocument = { defaultView: win };
  nav.getBoundingClientRect = () => ({ left: 24, right: 366, top: 700, bottom: 758, width: 342, height: 58 });
  const buttons = Array.from({ length: 5 }, (_, index) => {
    const captured = new Set();
    const button = {
      closest: () => button,
      getBoundingClientRect: () => ({ left: 31 + index * 66, width: 64 }),
      setPointerCapture: id => captured.add(id), hasPointerCapture: id => captured.has(id),
      releasePointerCapture: id => {
        captured.delete(id);
        const event = new Event('lostpointercapture'); Object.defineProperty(event, 'pointerId', { value: id }); nav.dispatchEvent(event);
      },
    };
    return button;
  });
  nav.querySelectorAll = () => buttons; nav.contains = button => buttons.includes(button);
  let preview = null;
  const selected = [];
  const cleanup = attachToolbarSlide(nav, { onPreview: value => { preview = value; }, onSelect: index => selected.push(index) });
  const center = index => 63 + index * 66;
  const send = (type, x = center(0), y = 729, options = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(event, Object.fromEntries(Object.entries({
      pointerId: 1, button: 0, isPrimary: true, pointerType: 'touch', clientX: x, clientY: y,
      target: buttons[0], detail: 1, ...options,
    }).map(([key, value]) => [key, { value }])));
    nav.dispatchEvent(event); return event;
  };
  const drag = () => { send('pointerdown'); return send('pointermove', center(2)); };
  return { win, nav, buttons, selected, center, send, drag, cleanup, get preview() { return preview; } };
}

test('toolbar order matches the owner request and never exposes Team to employees', () => {
  assert.deepEqual(mobileToolbarItems(true).map(item => item.label), ['Home', 'Team', 'Schedule', 'Alerts', 'Payouts']);
  assert.deepEqual(mobileToolbarItems(false).map(item => item.key), ['overview', 'creative', 'scheduling', 'alerts', 'payouts']);
  assert.equal(mobileToolbarItems(false).at(-1).label, 'Earnings');
});

test('the highlight tracks a continuous position but navigation happens once on release', () => {
  const f = fixture();
  f.send('pointerdown');
  assert.equal(f.preview, null);
  assert.equal(f.send('pointermove', f.center(1) + 20).defaultPrevented, true);
  assert.ok(f.preview.position > 1 && f.preview.position < 2);
  assert.equal(f.preview.index, 1);
  f.send('pointermove', f.center(4));
  f.send('pointermove', f.center(2));
  assert.deepEqual(f.selected, [], 'crossing tabs does not navigate or open pages');
  f.send('pointerup', f.center(2));
  assert.deepEqual(f.selected, [2]);
  assert.equal(f.preview, null);
  assert.equal(f.send('click').defaultPrevented, true, 'the captured starting button cannot open after the drag');
  f.send('pointerup', f.center(2));
  assert.deepEqual(f.selected, [2]);
  f.cleanup();
});

test('normal taps, keyboard clicks, and the next tap keep native button activation', () => {
  const f = fixture();
  f.send('pointerdown'); f.send('pointerup');
  assert.deepEqual(f.selected, []);
  assert.equal(f.send('click').defaultPrevented, false);
  f.drag(); f.send('pointerup', f.center(2));
  assert.equal(f.send('click', undefined, undefined, { detail: 0 }).defaultPrevented, false, 'keyboard/assistive clicks remain usable');
  f.send('pointerdown', f.center(4), 729, { target: f.buttons[4] });
  f.send('pointerup', f.center(4), 729, { target: f.buttons[4] });
  assert.equal(f.send('click').defaultPrevented, false, 'a fresh tap clears drag click suppression');
  f.cleanup();
});

test('vertical scroll and releasing away from the toolbar cancel without opening a page', () => {
  const f = fixture();
  f.send('pointerdown');
  assert.equal(f.send('pointermove', f.center(0) + 2, 750).defaultPrevented, false);
  f.send('pointermove', f.center(4), 750); f.send('pointerup', f.center(4), 750);
  assert.deepEqual(f.selected, []);
  f.drag(); f.send('pointerup', f.center(2), 650);
  assert.deepEqual(f.selected, []); assert.equal(f.preview, null);
  f.drag(); f.send('pointermove', -200);
  assert.equal(f.preview.position, 0, 'the highlight stays within the bar');
  f.send('pointerup', -200);
  assert.deepEqual(f.selected, []);
  f.cleanup();
});

test('cancel, extra fingers, lost capture, resize and blur abort a slide', () => {
  for (const interrupt of [
    f => f.send('pointercancel'),
    f => f.send('pointerdown', f.center(4), 729, { pointerId: 2, isPrimary: false }),
    f => f.send('lostpointercapture'),
    f => f.win.dispatchEvent(new Event('resize')),
    f => f.win.dispatchEvent(new Event('blur')),
  ]) {
    const f = fixture(); f.drag(); interrupt(f);
    f.send('pointerup', f.center(2));
    assert.deepEqual(f.selected, []); assert.equal(f.preview, null);
    f.drag(); f.send('pointerup', f.center(3));
    assert.deepEqual(f.selected, [3], 'the next valid slide still works');
    f.cleanup();
  }
});

test('zoomed and desktop views do not intercept gestures, and cleanup removes listeners', () => {
  for (const prepare of [f => { f.win.innerWidth = 1024; }, f => { f.win.visualViewport.scale = 2; }]) {
    const f = fixture(); prepare(f);
    assert.equal(f.drag().defaultPrevented, false); f.send('pointerup', f.center(2));
    assert.deepEqual(f.selected, []); f.cleanup();
  }
  const f = fixture(); f.drag(); f.send('pointerup', f.center(2)); f.cleanup();
  assert.equal(f.send('click').defaultPrevented, false);
  assert.equal(f.drag().defaultPrevented, false);
  f.send('pointerup', f.center(4)); assert.deepEqual(f.selected, [2]);
});
