/**
 * Move one existing section to its final position without changing the others.
 * Both pointer dragging and keyboard controls use this operation.
 * @template {string} Section
 * @param {Section[]} order
 * @param {Section} section
 * @param {number} position
 * @returns {Section[]}
 */
export function moveDashboardSection(order, section, position) {
  const from = order.indexOf(section);
  if (from < 0 || !Number.isFinite(position)) return order;
  const to = Math.max(0, Math.min(order.length - 1, Math.trunc(position)));
  if (from === to) return order;
  const next = order.filter(id => id !== section);
  next.splice(to, 0, section);
  return next;
}

/**
 * A dragged row belongs after the rows whose centers it has passed.
 * @param {number} center
 * @param {number[]} otherCenters
 */
export function dashboardDropPosition(center, otherCenters) {
  return otherCenters.filter(other => center > other).length;
}

/** @param {number} x @param {number} y */
export function dashboardDragStarted(x, y) {
  return Math.hypot(x, y) >= 8;
}
