/**
 * Slide the current page to the top before a toolbar navigation is committed.
 * Native input cancels the slide without blocking the user's next gesture.
 * @param {Window} win
 * @returns {{finished: Promise<boolean>, cancel: () => void}}
 */
export function scrollToolbarToTop(win) {
  const from = Math.max(0, Number(win.scrollY) || 0);
  if (from <= 1 || win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    if (from > 0) win.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    return { finished: Promise.resolve(true), cancel: () => {} };
  }

  const duration = Math.min(600, Math.max(300, 300 + from * 0.12));
  const inputs = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
  let frame = 0, started = null, done = false;
  /** @type {(arrived: boolean) => void} */
  let resolveFinished = () => {};
  const finished = new Promise(resolve => { resolveFinished = resolve; });
  const complete = arrived => {
    if (done) return;
    done = true;
    win.cancelAnimationFrame(frame);
    inputs.forEach(type => win.removeEventListener(type, cancel));
    resolveFinished(arrived);
  };
  const cancel = () => complete(false);
  const tick = time => {
    if (done) return;
    frame = 0;
    started ??= time;
    const progress = Math.min(1, Math.max(0, (time - started) / duration));
    const remaining = (1 - progress) ** 3;
    win.scrollTo({ top: from * remaining, left: 0, behavior: 'instant' });
    if (progress === 1) complete(true);
    else frame = win.requestAnimationFrame(tick);
  };
  inputs.forEach(type => win.addEventListener(type, cancel, { passive: true }));
  frame = win.requestAnimationFrame(tick);
  return { finished, cancel };
}
