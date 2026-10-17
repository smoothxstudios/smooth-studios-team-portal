const DRAG_DISTANCE = 8;
const CLICK_SUPPRESSION_MS = 700;

/**
 * Keep a swipe over a button from activating it when the finger is released.
 * Pointer movement and scrolling stay native; keyboard and assistive clicks
 * remain available. Document capture also covers a finger leaving the root.
 * @param {HTMLElement} root
 */
export function attachScrollTapGuard(root) {
  const doc = root.ownerDocument;
  let gesture = null, suppressClickUntil = 0;
  const dragged = () => {
    if (gesture) gesture.dragged = true;
    suppressClickUntil = Date.now() + CLICK_SUPPRESSION_MS;
  };
  const displaced = event => gesture &&
    Math.max(Math.abs(event.clientX - gesture.x), Math.abs(event.clientY - gesture.y)) >= DRAG_DISTANCE;
  const additionalPointer = event => {
    if (gesture && event.pointerId !== gesture.id && (event.isPrimary === false || event.pointerType === 'touch')) dragged();
  };
  const start = event => {
    if (event.isPrimary === false || event.button !== 0) return;
    suppressClickUntil = 0;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false };
  };
  const move = event => {
    if (gesture && gesture.id === event.pointerId && displaced(event)) dragged();
  };
  const end = event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    if (displaced(event)) dragged();
    if (gesture.dragged) {
      dragged();
      // Radix menu items synthesize a detail-0 click from pointerup. Stopping
      // that handler here avoids swallowing legitimate keyboard/AT clicks.
      event.stopPropagation();
    }
    gesture = null;
  };
  const cancel = event => {
    if (gesture && gesture.id === event.pointerId) {
      dragged();
      gesture = null;
    }
  };
  const scroll = () => { if (gesture) dragged(); };
  const click = event => {
    if (event.detail !== 0 && Date.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  root.addEventListener('pointerdown', start, { capture: true, passive: true });
  root.addEventListener('click', click, { capture: true });
  doc.addEventListener('pointerdown', additionalPointer, { capture: true, passive: true });
  doc.addEventListener('pointermove', move, { capture: true, passive: true });
  doc.addEventListener('pointerup', end, { capture: true, passive: true });
  doc.addEventListener('pointercancel', cancel, { capture: true, passive: true });
  doc.addEventListener('scroll', scroll, { capture: true, passive: true });
  return () => {
    gesture = null; suppressClickUntil = 0;
    root.removeEventListener('pointerdown', start, { capture: true });
    root.removeEventListener('click', click, { capture: true });
    doc.removeEventListener('pointerdown', additionalPointer, { capture: true });
    doc.removeEventListener('pointermove', move, { capture: true });
    doc.removeEventListener('pointerup', end, { capture: true });
    doc.removeEventListener('pointercancel', cancel, { capture: true });
    doc.removeEventListener('scroll', scroll, { capture: true });
  };
}
