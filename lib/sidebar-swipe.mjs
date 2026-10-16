const EDGE_WIDTH = 48;
const SWIPE_DISTANCE = 56;
const MAX_DURATION = 1000;
const BLOCKED_TARGETS = 'a, button, input, textarea, select, video, canvas, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="button"], [role="listbox"], [role="menu"], [data-sidebar-swipe="ignore"]';
const OPEN_DIALOGS = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [aria-modal="true"]:not([data-state="closed"]), dialog[open]';

/**
 * Open a closed mobile sidebar after a deliberate right swipe near the left edge.
 * Vertical scrolling, nested horizontal scrollers, controls, and pinch zoom keep
 * their normal gestures. The existing Sheet handles focus and slide animation.
 * @param {Document} doc
 * @param {() => void} onOpen
 * @returns {() => void}
 */
export function attachSidebarSwipe(doc, onOpen) {
  const win = doc.defaultView;
  if (!win) return () => {};
  let gesture = null;

  const reset = () => { gesture = null; };
  const available = () => win.innerWidth < 768 && doc.visibilityState !== 'hidden'
    && (win.visualViewport?.scale ?? 1) <= 1.05
    && win.getSelection()?.isCollapsed !== false && !doc.querySelector(OPEN_DIALOGS);

  const start = event => {
    reset();
    if (event.defaultPrevented || event.touches.length !== 1 || !available()) return;
    const touch = event.touches[0];
    if (touch.clientX < 0 || touch.clientX > EDGE_WIDTH) return;
    const target = event.target;
    if (!(target instanceof win.Element) || !target.closest('[data-slot="sidebar-wrapper"]') || target.closest(BLOCKED_TARGETS)) return;
    for (let element = target; element && element !== doc.body; element = element.parentElement) {
      if (element.scrollWidth > element.clientWidth + 2 && /^(auto|scroll)$/.test(win.getComputedStyle(element).overflowX)) return;
    }
    gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, at: event.timeStamp, horizontal: false };
  };

  const move = event => {
    if (!gesture) return;
    if (event.touches.length !== 1 || event.defaultPrevented || !event.cancelable) return reset();
    const touch = event.touches[0];
    if (touch.identifier !== gesture.id || event.timeStamp - gesture.at > MAX_DURATION) return reset();
    const dx = touch.clientX - gesture.x;
    const dy = Math.abs(touch.clientY - gesture.y);
    if (Math.max(Math.abs(dx), dy) < 8) return;
    // Abandon vertical or leftward movement for the rest of this touch sequence.
    if (dx <= 0 || dx < dy * 1.5) return reset();
    gesture.horizontal = true;
    event.preventDefault();
  };

  const end = event => {
    const current = gesture;
    reset();
    if (!current?.horizontal || event.touches.length || event.defaultPrevented || !available()) return;
    const touch = Array.from(event.changedTouches).find(item => item.identifier === current.id);
    if (!touch || event.timeStamp - current.at > MAX_DURATION) return;
    const dx = touch.clientX - current.x;
    const dy = Math.abs(touch.clientY - current.y);
    if (dx < SWIPE_DISTANCE || dx < dy * 1.5) return;
    if (event.cancelable) event.preventDefault();
    onOpen();
  };

  doc.addEventListener('touchstart', start, { passive: true });
  doc.addEventListener('touchmove', move, { passive: false });
  doc.addEventListener('touchend', end, { passive: false });
  doc.addEventListener('touchcancel', reset, { passive: true });
  return () => {
    reset();
    doc.removeEventListener('touchstart', start);
    doc.removeEventListener('touchmove', move);
    doc.removeEventListener('touchend', end);
    doc.removeEventListener('touchcancel', reset);
  };
}
