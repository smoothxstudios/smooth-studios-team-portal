import { TEAM, localInstant, studioLocal } from "../lib/team-schedule.mjs";
import { reconcileAdvances, withCreativeAdvance } from "./payroll.mjs";
import { notificationText } from "./notification-content.mjs";
import { flushAlerts } from "./push.mjs";
import { DEFAULT_PAY_WORK_TYPES } from "../lib/pay-work-types.mjs";

// Manual earnings share the existing non-rental ledger and payout safeguards.
// They never create a Calendar offer or bypass another assignment's approval.
export async function manualPayRoute({ request, db, user, env, ctx, body, fail }) {
  if (user !== "owner") fail(403, "Only Smooth can add pay.");
  if (request.method !== "POST") fail(405, "Use Add pay to create a record.");
  const input = await body(request), now = new Date().toISOString();
  const text = (value, max, required = false) => {
    if (typeof value !== "string" || value.length > max || (required && !value.trim())) fail(400, "Check the required fields and text limits.");
    return value.trim();
  };
  const day = value => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value > studioLocal(now).slice(0, 10)) fail(400, "Choose a valid date today or earlier.");
    try { return localInstant(`${value}T00:00`); } catch { fail(400, "Choose a valid date today or earlier."); }
  };
  if (!/^[a-f0-9-]{36}$/.test(input.id ?? "")) fail(400, "Reopen Add pay and try again.");
  if (!TEAM.some(p => p.id === input.employeeId && p.id !== "owner") || !JSON.parse(env.TEAM_TOKEN_HASHES)[input.employeeId]) fail(400, "Choose a team member with an active dashboard account.");
  const workType = DEFAULT_PAY_WORK_TYPES.find(item => item.id === input.category)
    || (typeof input.category === 'string' && input.category.length <= 100
      ? await db.prepare('SELECT id,label FROM owner_pay_work_types WHERE id=?').bind(input.category).first() : null);
  if (!workType) fail(400, "Choose a saved work type or use Add option first.");
  if (!["owed", "paid"].includes(input.paymentStatus)) fail(400, "Choose whether this pay is owed or already paid.");
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > 10_000_000) fail(400, "Enter an amount between $0.01 and $100,000.");
  const earnedAt = day(input.workDate), paidAt = input.paymentStatus === "paid" ? day(input.paidDate) : null;
  const title = input.category === "other" ? text(input.title, 160, true) : workType.label;
  const note = text(input.note ?? "", 4000), method = input.paymentStatus === "paid" ? text(input.method ?? "", 80) : "";
  const receipt = { employeeId: input.employeeId, category: input.category, title, workDate: input.workDate, amountCents: input.amountCents,
    paymentStatus: input.paymentStatus, paidDate: paidAt ? input.paidDate : null, method, note };
  const duplicate = async () => {
    const row = await db.prepare("SELECT data FROM team_creative_assignments WHERE id = ?").bind(input.id).first();
    if (!row) return null;
    const saved = JSON.parse(row.data);
    if (saved.entryType !== "manual" || JSON.stringify(saved.manualReceipt) !== JSON.stringify(receipt)) fail(409, "This pay entry was already saved with different details. Refresh Payouts to review it before adding another.");
    await reconcileAdvances(db);
    return { assignment: await withCreativeAdvance(db, saved), duplicate: true };
  };
  const existing = await duplicate();
  if (existing) return existing;
  const mutation = crypto.randomUUID();
  const item = { id: input.id, employeeId: input.employeeId, entryType: "manual", workCategory: input.category, manualReceipt: receipt,
    title, instructions: note, earnedAt, dueAt: earnedAt, amountCents: input.amountCents, references: [], status: "approved", version: 1,
    createdAt: now, updatedAt: now, approvedAt: now, submissions: [],
    payments: paidAt ? [{ id: crypto.randomUUID(), amountCents: input.amountCents, method, paidAt, recordedAt: now }] : [],
    history: [{ id: mutation, event: paidAt ? "pay and payment recorded" : "pay added", by: user, at: now }] };
  const payload = JSON.stringify({ title: paidAt ? "Payment recorded" : "Pay added", body: `${notificationText(title, 160)} · ${input.workDate}. View the amount and payment status in Earnings.`, target: "payouts", targetId: item.id, personId: item.employeeId });
  const result = await db.batch([
    db.prepare("INSERT OR IGNORE INTO team_creative_assignments (id, employee_id, version, mutation, data) VALUES (?, ?, 1, ?, ?)").bind(item.id, item.employeeId, mutation, JSON.stringify(item)),
    db.prepare(`INSERT INTO team_notification_events (id, user_id, kind, payload, due_at)
      SELECT ?, ?, 'creative', ?, ? WHERE EXISTS (SELECT 1 FROM team_creative_assignments WHERE id = ? AND mutation = ?)`)
      .bind(mutation, item.employeeId, payload, Date.now(), item.id, mutation),
  ]);
  if (!result[0].meta.changes) return duplicate();
  ctx.waitUntil(flushAlerts(env));
  await reconcileAdvances(db);
  return { assignment: await withCreativeAdvance(db, item) };
}
