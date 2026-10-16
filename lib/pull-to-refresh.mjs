export const PULL_REFRESH_THRESHOLD = 64;
const BLOCKED = 'a, button, input, textarea, select, video, canvas, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="button"], [data-pull-refresh="ignore"]';
const MODALS = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [aria-modal="true"]:not([data-state="closed"]), dialog[open]';

/**
 * A downward, single-finger gesture that begins at the page top. Nested scroll
 * areas, forms, menus, zoom, and horizontal navigation keep their own gestures.
 * @param {HTMLElement} root
 * @param {{onPull: (distance: number) => void, onRelease: () => void, isBusy: () => boolean, isBlocked: () => boolean}} callbacks
 */
export function attachPullToRefresh(root, { onPull, onRelease, isBusy, isBlocked }) {
  const doc = root.ownerDocument, win = doc.defaultView;
  if (!win) return () => {};
  let gesture = null;
  const reset = () => { if (gesture) onPull(0); gesture = null; };
  const available = () => win.innerWidth < 768 && win.scrollY <= 1 && doc.visibilityState !== 'hidden'
    && (win.visualViewport?.scale ?? 1) <= 1.05 && !isBusy() && !isBlocked()
    && win.getSelection()?.isCollapsed !== false && !doc.querySelector(MODALS);
  const start = event => {
    reset();
    if (event.defaultPrevented || event.touches.length !== 1 || !available()) return;
    const target = event.target;
    if (!(target instanceof win.Element) || target.closest(BLOCKED)
      || doc.activeElement?.matches?.('input, textarea, select, [contenteditable="true"]')) return;
    for (let element = target; element && element !== root; element = element.parentElement) {
      const style = win.getComputedStyle(element);
      if ((element.scrollHeight > element.clientHeight + 2 && /auto|scroll/.test(style.overflowY))
        || (element.scrollWidth > element.clientWidth + 2 && /auto|scroll/.test(style.overflowX))) return;
    }
    const touch = event.touches[0];
    gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, distance: 0, pulling: false };
  };
  const move = event => {
    if (!gesture) return;
    if (event.touches.length !== 1 || event.defaultPrevented || !event.cancelable || !available()) return reset();
    const touch = event.touches[0];
    if (touch.identifier !== gesture.id) return reset();
    const dx = Math.abs(touch.clientX - gesture.x), dy = touch.clientY - gesture.y;
    if (!gesture.pulling) {
      if (Math.max(dx, Math.abs(dy)) < 7) return;
      if (dy <= 0 || dy < dx * 1.5) return reset();
      gesture.pulling = true;
    }
    event.preventDefault();
    // Increasing resistance gives the page a soft stop without a hard clamp.
    gesture.distance = 96 * (1 - Math.exp(-Math.max(0, dy) / 140));
    onPull(gesture.distance);
  };
  const end = event => {
    if (!gesture) return;
    const current = gesture;
    const touch = Array.from(event.changedTouches).find(item => item.identifier === current.id);
    const armed = current.pulling && current.distance >= PULL_REFRESH_THRESHOLD;
    if (!touch || event.touches.length || event.defaultPrevented || !available()) return reset();
    gesture = null;
    if (current.pulling && event.cancelable) event.preventDefault();
    if (armed) onRelease(); else onPull(0);
  };
  root.addEventListener('touchstart', start, { passive: true });
  root.addEventListener('touchmove', move, { passive: false });
  root.addEventListener('touchend', end, { passive: false });
  root.addEventListener('touchcancel', reset, { passive: true });
  win.addEventListener('resize', reset);
  doc.addEventListener('visibilitychange', reset);
  return () => {
    reset(); root.removeEventListener('touchstart', start); root.removeEventListener('touchmove', move);
    root.removeEventListener('touchend', end); root.removeEventListener('touchcancel', reset);
    win.removeEventListener('resize', reset); doc.removeEventListener('visibilitychange', reset);
  };
}
