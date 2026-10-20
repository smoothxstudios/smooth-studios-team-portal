export const DEFAULT_DASHBOARD_ORDER = Object.freeze(["upcoming", "attention", "finances", "hours", "creative", "reports"]);
export const DASHBOARD_SECTION_IDS = DEFAULT_DASHBOARD_ORDER;
const known = new Set(DASHBOARD_SECTION_IDS);

/** Read older saved preferences without losing new sections or repeating one. */
export function normalizeDashboardOrder(value) {
  const order = [];
  for (const id of Array.isArray(value) ? value : []) if (known.has(id) && !order.includes(id)) order.push(id);
  return [...order, ...DASHBOARD_SECTION_IDS.filter(id => !order.includes(id))];
}

/** Saves must name every current section exactly once. */
export function validDashboardOrder(value) {
  return Array.isArray(value) && value.length === DASHBOARD_SECTION_IDS.length &&
    value.every(id => known.has(id)) && new Set(value).size === DASHBOARD_SECTION_IDS.length;
}

export function actionFocusedHomeOrder(order) {
  const oldDefault = ["upcoming", "attention", "finances", "hours", "creative", "reports"];
  return JSON.stringify(order) === JSON.stringify(oldDefault) ? ["upcoming", "attention", "creative", "hours", "finances", "reports"] : order;
}
