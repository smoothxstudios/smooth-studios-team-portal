import { studioLocal } from "./team-schedule.mjs";

export const CREATIVE_STATUS = { offered: "New offer", accepted: "In progress", submitted: "Awaiting review", revision: "Changes requested", approved: "Approved", declined: "Declined", cancelled: "Cancelled" };
export const creativePaid = item => (item.payments ?? []).reduce((sum, payment) => sum + payment.amountCents, 0);
export const creativeOwed = item => item.status === "approved" ? Math.max(0, item.amountCents - creativePaid(item)) : 0;
export const creativeEarningDate = item => item.approvedAt ?? item.dueAt ?? item.createdAt;
/** @param {import("./use-creative-work").CreativeAssignment[]} items
 * @param {number | undefined} [year] */
export function creativeEarnings(items, year) {
  const selected = year ? items.filter(item => studioLocal(creativeEarningDate(item)).slice(0, 4) === String(year)) : items;
  const metrics = { paid: 0, owed: 0, projected: 0 };
  const monthly = Array.from({ length: 12 }, () => ({ paid: 0, owed: 0 }));
  for (const item of selected) {
    const paid = creativePaid(item), owed = creativeOwed(item);
    metrics.paid += paid; metrics.owed += owed;
    if (["offered", "accepted", "submitted", "revision"].includes(item.status)) metrics.projected += item.amountCents;
    const index = Number(studioLocal(creativeEarningDate(item)).slice(5, 7)) - 1;
    monthly[index].paid += paid; monthly[index].owed += owed;
  }
  return { items: selected, metrics, monthly };
}
export function moneyInputCents(value) {
  if (typeof value !== "string" || !/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, decimal = ""] = value.trim().split(".");
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 10_000_000 ? cents : null;
}
