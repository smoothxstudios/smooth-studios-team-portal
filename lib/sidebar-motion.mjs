import { stepSpring } from './ui-spring.mjs';

/** The real modal follows the finger; React only mounts it and commits the result. */
export function createSidebarMotion(doc, setOpen) {
  const win = doc.defaultView, root = doc.documentElement;
  let frame = 0, position = 0, origin = 0, width = 340, velocity = 0, previousTime = 0;
  let active = false, panel = null, startedOpen = false;
  const cancelFrame = () => { win.cancelAnimationFrame(frame); frame = 0; };
  const paint = () => {
    root.style.setProperty('--sidebar-drag-x', `${position}px`);
    root.style.setProperty('--sidebar-drag-opacity', String(Math.max(0, Math.min(1, 1 + position / width))));
  };
  const clear = () => {
    root.removeAttribute('data-sidebar-motion');
    root.style.removeProperty('--sidebar-drag-x');
    root.style.removeProperty('--sidebar-drag-opacity');
    active = false;
  };
  const finish = open => {
    setOpen(open);
    if (open) {
      panel?.setAttribute('data-sidebar-settled', 'true');
      clear();
      if (panel && !panel.contains(doc.activeElement)) (panel.querySelector('button, a[href]') ?? panel).focus({ preventScroll: true });
    } else {
      // Keep the CSS exit disabled until Radix has removed the closed content.
      frame = win.requestAnimationFrame(() => { frame = win.requestAnimationFrame(clear); });
    }
  };
  const settle = open => {
    cancelFrame();
    const target = open ? 0 : -width;
    if (win.matchMedia('(prefers-reduced-motion: reduce)').matches) { position = target; paint(); finish(open); return; }
    let previous = win.performance.now();
    const tick = now => {
      if (!panel?.isConnected || panel.dataset.state === 'closed') { clear(); return; }
      const next = stepSpring(position, velocity, target, (now - previous) / 1000, open ? .3 : .24);
      previous = now; position = Math.max(-width, Math.min(0, next.position)); velocity = next.velocity; paint();
      if (Math.abs(position - target) < .4 && Math.abs(velocity) < 5) { position = target; paint(); finish(open); }
      else frame = win.requestAnimationFrame(tick);
    };
    frame = win.requestAnimationFrame(tick);
  };
  return {
    get active() { return active; },
    begin(open, at) {
      cancelFrame(); startedOpen = open;
      width = Math.min(340, win.innerWidth - 36);
      if (!active) position = open ? 0 : -width;
      origin = position; velocity = 0; previousTime = at; active = true;
      root.setAttribute('data-sidebar-motion', 'true'); paint();
      if (!open) setOpen(true);
      panel = doc.querySelector('[data-sidebar="sidebar"][data-mobile="true"][data-state="open"]');
      return panel;
    },
    move(dx, at) {
      const next = Math.max(-width, Math.min(0, origin + dx));
      const elapsed = at - previousTime;
      if (elapsed > 0) velocity = (next - position) / elapsed * 1000;
      position = next; previousTime = at; paint();
    },
    end(open, at) {
      if (at - previousTime > 100) velocity = 0;
      // A deliberate reversal wins over distance already travelled.
      if (!startedOpen && velocity < -120) open = false;
      if (startedOpen && velocity > 120) open = true;
      settle(open);
    },
    cancel() { if (active) { velocity = 0; settle(startedOpen); } },
    destroy() { cancelFrame(); clear(); },
  };
}
