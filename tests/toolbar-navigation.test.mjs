import test from 'node:test';
import assert from 'node:assert/strict';
import { scrollToolbarToTop } from '../lib/toolbar-navigation.mjs';

function fixture(y = 1000, reduced = false) {
  const win = new EventTarget(), frames = new Map(), listeners = new Set(), positions = [];
  let nextFrame = 0;
  const nativeAdd = win.addEventListener.bind(win), nativeRemove = win.removeEventListener.bind(win);
  Object.assign(win, {
    scrollY: y,
    matchMedia: query => ({ matches: query === '(prefers-reduced-motion: reduce)' && reduced }),
    scrollTo: options => { win.scrollY = options.top; positions.push(options); },
    requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: id => frames.delete(id),
    addEventListener: (type, listener, options) => { listeners.add(type); nativeAdd(type, listener, options); },
    removeEventListener: (type, listener) => { listeners.delete(type); nativeRemove(type, listener); },
  });
  const step = time => {
    const pending = [...frames.values()]; frames.clear();
    pending.forEach(callback => callback(time));
  };
  return { win, positions, frames, listeners, step };
}

test('toolbar scrolling eases through intermediate positions before reporting arrival', async () => {
  const f = fixture(), slide = scrollToolbarToTop(f.win);
  let arrived = false;
  void slide.finished.then(value => { arrived = value; });
  assert.equal(f.win.scrollY, 1000, 'starting a slide never teleports to the top');
  f.step(100); f.step(205);
  const quarter = f.win.scrollY;
  assert.ok(quarter > 0 && quarter < 1000);
  assert.equal(arrived, false, 'navigation must wait for arrival');
  f.step(310);
  assert.ok(f.win.scrollY > 0 && f.win.scrollY < quarter);
  assert.ok(1000 - quarter > quarter - f.win.scrollY, 'the slide slows as it approaches the top');
  f.step(520);
  assert.equal(await slide.finished, true);
  assert.equal(f.win.scrollY, 0);
  assert.ok(f.positions.every(position => position.behavior === 'instant'), 'the frame loop owns easing');
  assert.equal(f.frames.size, 0);
  assert.equal(f.listeners.size, 0);
  slide.cancel();
  assert.equal(await slide.finished, true, 'cancelling after completion cannot revoke arrival');
});

test('short and long slides use bounded, distance-sensitive durations', async () => {
  const near = fixture(100), far = fixture(10_000);
  const nearSlide = scrollToolbarToTop(near.win), farSlide = scrollToolbarToTop(far.win);
  near.step(0); far.step(0); near.step(299); far.step(299);
  assert.ok(near.win.scrollY > 0 && far.win.scrollY > 0, 'slides run for at least 300ms');
  near.step(350); far.step(350);
  assert.equal(await nearSlide.finished, true);
  assert.ok(far.win.scrollY > 0, 'longer pages get more travel time');
  far.step(600);
  assert.equal(await farSlide.finished, true);
});

test('already-top and reduced-motion requests complete immediately without animation listeners', async () => {
  for (const f of [fixture(0), fixture(1400, true)]) {
    const slide = scrollToolbarToTop(f.win);
    assert.equal(await slide.finished, true);
    assert.equal(f.win.scrollY, 0);
    assert.equal(f.frames.size, 0);
    assert.equal(f.listeners.size, 0);
  }
});

test('explicit cancellation preserves position and removes the pending frame and listeners', async () => {
  const f = fixture(), slide = scrollToolbarToTop(f.win);
  f.step(0); f.step(100);
  const stoppedAt = f.win.scrollY;
  slide.cancel(); slide.cancel(); f.step(1000);
  assert.equal(await slide.finished, false);
  assert.equal(f.win.scrollY, stoppedAt);
  assert.equal(f.frames.size, 0);
  assert.equal(f.listeners.size, 0);
});

test('native gestures cancel without being prevented and no stale navigation can finish', async () => {
  for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    const f = fixture(), slide = scrollToolbarToTop(f.win);
    f.step(0); f.step(100);
    const stoppedAt = f.win.scrollY, input = new Event(type, { cancelable: true });
    f.win.dispatchEvent(input); f.step(1000);
    assert.equal(input.defaultPrevented, false, `${type} stays native`);
    assert.equal(await slide.finished, false);
    assert.equal(f.win.scrollY, stoppedAt);
    assert.equal(f.frames.size, 0);
    assert.equal(f.listeners.size, 0);
  }
});

test('a replacement toolbar request resumes from the current position and only the latest can arrive', async () => {
  const f = fixture(), first = scrollToolbarToTop(f.win);
  f.step(0); f.step(100);
  const current = f.win.scrollY;
  first.cancel();
  const latest = scrollToolbarToTop(f.win);
  assert.equal(f.win.scrollY, current);
  assert.equal(await first.finished, false);
  f.step(100); f.step(700);
  assert.equal(await latest.finished, true);
  assert.equal(f.win.scrollY, 0);
  assert.equal(f.frames.size, 0);
  assert.equal(f.listeners.size, 0);
});
