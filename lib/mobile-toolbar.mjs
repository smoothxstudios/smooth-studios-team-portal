/** @returns {Array<{key: 'overview'|'team'|'creative'|'scheduling'|'alerts'|'payouts', label: string, icon: 'home'|'team'|'work'|'schedule'|'alerts'|'payouts'}>} */
export function mobileToolbarItems(isOwner) {
  return [
    { key: 'overview', label: 'Home', icon: 'home' },
    isOwner ? { key: 'team', label: 'Team', icon: 'team' } : { key: 'creative', label: 'Work', icon: 'work' },
    { key: 'scheduling', label: 'Schedule', icon: 'schedule' },
    { key: 'alerts', label: 'Alerts', icon: 'alerts' },
    { key: 'payouts', label: isOwner ? 'Payouts' : 'Earnings', icon: 'payouts' },
  ];
}

/** Directional scroll with hysteresis; clamp iOS overscroll before comparing. */
export function toolbarScrollState(previous, rawY, maxY) {
  const y = Math.max(0, Math.min(rawY, Math.max(0, maxY)));
  const delta = y - previous.y;
  if (y <= 40) return { y, direction: 0, travel: 0, hidden: false };
  if (Math.abs(delta) < 1) return previous;
  const direction = Math.sign(delta);
  const travel = direction === previous.direction ? previous.travel + Math.abs(delta) : Math.abs(delta);
  const hidden = direction > 0 && travel >= 160 && y > 240 ? true : direction < 0 && travel >= 10 ? false : previous.hidden;
  return { y, direction, travel, hidden };
}

/** Hide during downward page scrolling; a small upward scroll restores the bar. */
export function attachToolbarScroll(nav) {
  const doc = nav.ownerDocument, win = doc.defaultView;
  if (!win) return () => {};
  let frame = 0;
  let state = { y: Math.max(0, win.scrollY), direction: 0, travel: 0, hidden: false };
  const show = () => {
    state = { y: Math.max(0, win.scrollY), direction: 0, travel: 0, hidden: false };
    nav.dataset.scrollHidden = 'false';
  };
  const scroll = () => {
    if (frame) return;
    frame = win.requestAnimationFrame(() => {
      frame = 0;
      if (win.innerWidth >= 768 || nav.dataset.dragging === 'true' || nav.querySelector(':focus-visible')) return show();
      state = toolbarScrollState(state, win.scrollY, doc.documentElement.scrollHeight - win.innerHeight);
      nav.dataset.scrollHidden = String(state.hidden);
    });
  };
  win.addEventListener('scroll', scroll, { passive: true });
  win.addEventListener('resize', show);
  nav.addEventListener('focusin', show);
  show();
  return () => {
    win.cancelAnimationFrame(frame); win.removeEventListener('scroll', scroll);
    win.removeEventListener('resize', show); nav.removeEventListener('focusin', show);
  };
}

/**
 * Preview tabs while dragging, then open only the tab released over. Ordinary
 * clicks (including keyboard and screen-reader activation) remain button clicks.
 * CSS pan-y/pinch-zoom leaves scrolling and zooming with the browser.
 * @param {HTMLElement} nav
 * @param {{onPreview: (preview: {position: number, index: number} | null) => void, onSelect: (index: number) => void}} callbacks
 */
export function attachToolbarSlide(nav, { onPreview, onSelect }) {
  const win = nav.ownerDocument.defaultView;
  let gesture = null, blockClickUntil = 0;
  const stop = (blockClick = false) => {
    const current = gesture;
    gesture = null;
    if (blockClick) blockClickUntil = Date.now() + 750;
    if (current) {
      if (current.button.hasPointerCapture?.(current.id)) current.button.releasePointerCapture(current.id);
      onPreview(null);
    }
  };
  const targetAt = x => {
    const position = Math.max(0, Math.min(gesture.count - 1, (x - gesture.firstCenter) / gesture.step));
    return { position, index: Math.round(position) };
  };
  const start = event => {
    if (!event.isPrimary) { stop(true); return; }
    stop(); blockClickUntil = 0;
    if (event.defaultPrevented || event.button !== 0 || !win || win.innerWidth >= 768 || (win.visualViewport?.scale ?? 1) > 1.05) return;
    const button = event.target.closest?.('button[data-toolbar-index]');
    if (!button || !nav.contains(button) || typeof button.setPointerCapture !== 'function') return;
    const buttons = Array.from(nav.querySelectorAll('button[data-toolbar-index]'));
    const rect = nav.getBoundingClientRect();
    const first = buttons[0]?.getBoundingClientRect(), second = buttons[1]?.getBoundingClientRect();
    if (!first || !second || !rect.height || second.left <= first.left) return;
    // Capture on the original button so a normal tap still produces its click.
    try { button.setPointerCapture(event.pointerId); } catch { return; }
    gesture = { id: event.pointerId, button, x: event.clientX, y: event.clientY, rect,
      count: buttons.length, firstCenter: first.left + first.width / 2, step: second.left - first.left, dragging: false };
  };
  const move = event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    if (event.defaultPrevented) { stop(true); return; }
    const dx = Math.abs(event.clientX - gesture.x), dy = Math.abs(event.clientY - gesture.y);
    if (!gesture.dragging) {
      if (Math.max(dx, dy) < 8) return;
      if (dx < dy * 1.3) { stop(true); return; }
      gesture.dragging = true;
    }
    if (event.clientY < gesture.rect.top - 28 || event.clientY > gesture.rect.bottom + 28) { stop(true); return; }
    if (event.cancelable) event.preventDefault();
    onPreview(targetAt(event.clientX));
  };
  const end = event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const current = gesture;
    const inside = event.clientX >= current.rect.left - 24 && event.clientX <= current.rect.right + 24
      && event.clientY >= current.rect.top - 28 && event.clientY <= current.rect.bottom + 28;
    const choice = current.dragging && inside && !event.defaultPrevented ? targetAt(event.clientX).index : null;
    stop(current.dragging || !inside);
    if (choice !== null) {
      if (event.cancelable) event.preventDefault();
      onSelect(choice);
    }
  };
  const cancel = () => stop(true);
  const lostCapture = event => { if (gesture?.id === event.pointerId) stop(true); };
  const click = event => {
    // Swallow the synthetic click after a drag, but never keyboard/AT clicks.
    if (event.detail !== 0 && Date.now() < blockClickUntil) {
      event.preventDefault(); event.stopImmediatePropagation(); blockClickUntil = 0;
    }
  };
  nav.addEventListener('pointerdown', start);
  nav.addEventListener('pointermove', move, { passive: false });
  nav.addEventListener('pointerup', end);
  nav.addEventListener('pointercancel', cancel);
  nav.addEventListener('lostpointercapture', lostCapture);
  nav.addEventListener('click', click, { capture: true });
  win?.addEventListener('resize', cancel);
  win?.addEventListener('blur', cancel);
  return () => {
    stop();
    nav.removeEventListener('pointerdown', start);
    nav.removeEventListener('pointermove', move);
    nav.removeEventListener('pointerup', end);
    nav.removeEventListener('pointercancel', cancel);
    nav.removeEventListener('lostpointercapture', lostCapture);
    nav.removeEventListener('click', click, { capture: true });
    win?.removeEventListener('resize', cancel);
    win?.removeEventListener('blur', cancel);
  };
}
