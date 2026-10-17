const EDGE_WIDTH = 48;
const SWIPE_DISTANCE = 56;
const MAX_DURATION = 1000;
const CLICK_SUPPRESSION_MS = 700;
const BLOCKED_TARGETS = 'a, button, input, textarea, select, video, canvas, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="button"], [role="listbox"], [role="menu"], [data-sidebar-swipe="ignore"]';
const CLOSE_BLOCKED_TARGETS = 'input, textarea, select, video, canvas, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="listbox"], [role="menu"], [data-sidebar-swipe="ignore"]';
const OPEN_DIALOGS = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [aria-modal="true"]:not([data-state="closed"]), dialog[open]';
const MOBILE_SIDEBAR = '[data-sidebar="sidebar"][data-mobile="true"][data-state="open"]';

/**
 * Swipe right from the page's left edge to open, or left across the menu to close.
 * Vertical scrolling, nested horizontal scrollers, controls, and pinch zoom keep
 * their normal gestures. The existing Sheet handles focus and slide animation.
 * @param {Document} doc
 * @param {() => void} onOpen
 * @param {() => void} [onClose]
 * @returns {() => void}
 */
export function attachSidebarSwipe(doc, onOpen, onClose) {
  const win = doc.defaultView;
  if (!win) return () => {};
  let gesture = null;
  let suppressClickUntil = 0;

  const reset = () => { gesture = null; };
  const available = sidebar => win.innerWidth < 768 && doc.visibilityState !== 'hidden'
    && (win.visualViewport?.scale ?? 1) <= 1.05
    && win.getSelection()?.isCollapsed !== false
    && !Array.from(doc.querySelectorAll(OPEN_DIALOGS)).some(dialog => dialog !== sidebar);

  const start = event => {
    reset();
    suppressClickUntil = 0;
    const sidebar = onClose ? doc.querySelector(MOBILE_SIDEBAR) : null;
    if (event.defaultPrevented || event.touches.length !== 1 || !available(sidebar)) return;
    const touch = event.touches[0];
    if (!sidebar && (touch.clientX < 0 || touch.clientX > EDGE_WIDTH)) return;
    const target = event.target;
    if (!(target instanceof win.Element)) return;
    if (sidebar ? target.closest(MOBILE_SIDEBAR) !== sidebar || target.closest(CLOSE_BLOCKED_TARGETS)
      : !target.closest('[data-slot="sidebar-wrapper"]') || target.closest(BLOCKED_TARGETS)) return;
    for (let element = target; element && element !== doc.body; element = element.parentElement) {
      if (element.scrollWidth > element.clientWidth + 2 && /^(auto|scroll)$/.test(win.getComputedStyle(element).overflowX)) return;
    }
    gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, at: event.timeStamp, horizontal: false, sidebar };
  };

  const move = event => {
    if (!gesture) return;
    if (event.touches.length !== 1 || event.defaultPrevented || !event.cancelable) return reset();
    const touch = event.touches[0];
    if (touch.identifier !== gesture.id || event.timeStamp - gesture.at > MAX_DURATION) return reset();
    const dx = (touch.clientX - gesture.x) * (gesture.sidebar ? -1 : 1);
    const dy = Math.abs(touch.clientY - gesture.y);
    if (Math.max(Math.abs(dx), dy) < 8) return;
    // Abandon vertical or opposite-direction movement for this touch sequence.
    if (dx <= 0 || dx < dy * 1.5) return reset();
    gesture.horizontal = true;
    suppressClickUntil = Date.now() + CLICK_SUPPRESSION_MS;
    event.preventDefault();
  };

  const end = event => {
    const current = gesture;
    reset();
    if (!current?.horizontal) return;
    // Keep a dragged navigation row from becoming a tap, even for a short swipe.
    suppressClickUntil = Date.now() + CLICK_SUPPRESSION_MS;
    if (event.touches.length || event.defaultPrevented || !available(current.sidebar)) return;
    if (current.sidebar && doc.querySelector(MOBILE_SIDEBAR) !== current.sidebar) return;
    const touch = Array.from(event.changedTouches).find(item => item.identifier === current.id);
    if (!touch || event.timeStamp - current.at > MAX_DURATION) return;
    const dx = (touch.clientX - current.x) * (current.sidebar ? -1 : 1);
    const dy = Math.abs(touch.clientY - current.y);
    if (event.cancelable) event.preventDefault();
    if (dx < SWIPE_DISTANCE || dx < dy * 1.5) return;
    if (current.sidebar) onClose();
    else onOpen();
  };

  const click = event => {
    if (event.detail !== 0 && Date.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  doc.addEventListener('touchstart', start, { passive: true });
  doc.addEventListener('touchmove', move, { passive: false });
  doc.addEventListener('touchend', end, { passive: false });
  doc.addEventListener('touchcancel', reset, { passive: true });
  doc.addEventListener('click', click, { capture: true });
  return () => {
    reset();
    doc.removeEventListener('touchstart', start);
    doc.removeEventListener('touchmove', move);
    doc.removeEventListener('touchend', end);
    doc.removeEventListener('touchcancel', reset);
    doc.removeEventListener('click', click, { capture: true });
  };
}
