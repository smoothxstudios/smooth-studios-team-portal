import { TEAM, localInstant } from "../lib/team-schedule.mjs";
import { reconcileAdvances, creativeAdvanceAmounts, withCreativeAdvance } from "./payroll.mjs";
import { creativeOwed } from "../lib/creative-work.mjs";
import { notificationText } from "./notification-content.mjs";
import { flushAlerts } from "./push.mjs";

export async function creativeWorkRoute({ request, db, user, env, ctx, body, fail }) {
  const url = new URL(request.url), isOwner = user === "owner";
  const text = (value, max, required = true) => {
    if (typeof value !== "string" || value.length > max || (required && !value.trim())) fail(400, "Fill in the required fields and keep text within the displayed limits.");
    return value.trim();
  };
  const links = value => {
    if (!Array.isArray(value) || value.length > 10) fail(400, "Add up to 10 links.");
    return [...new Set(value.map(link => {
      let parsed;
      try { parsed = new URL(text(link, 2048)); } catch { fail(400, "Use complete https:// links for references and submissions."); }
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) fail(400, "Use complete https:// links without embedded sign-in details.");
      return parsed.href;
    }))];
  };
  const amount = value => {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 10_000_000) fail(400, "Enter a payment amount between $0.01 and $100,000.");
    return value;
  };
  const requireOwner = () => { if (!isOwner) fail(403, "Only Smooth can assign, approve, or record payments for creative work."); };
  const id = url.pathname.match(/^\/creative-work\/([a-f0-9-]{36})$/)?.[1];
  if (request.method === "GET" && url.pathname === "/creative-work") {
    const rows = await (isOwner ? db.prepare("SELECT data FROM team_creative_assignments")
      : db.prepare("SELECT data FROM team_creative_assignments WHERE employee_id = ?").bind(user)).all();
    await reconcileAdvances(db);
    const amounts = await creativeAdvanceAmounts(db, isOwner ? null : user);
    return { assignments: rows.results.map(row => { const item = JSON.parse(row.data); return { ...item, advanceAppliedCents: Math.min(item.amountCents, amounts.get(item.id) ?? 0) }; }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
  }
  if (!(request.method === "POST" && url.pathname === "/creative-work") && !(request.method === "PATCH" && id)) fail(404, "Creative assignment not found.");
  const input = await body(request), now = new Date().toISOString();
  const mutation = crypto.randomUUID();
  let item, event, previous;
  const terms = () => {
    let dueAt;
    try { dueAt = localInstant(text(input.dueLocal, 16)); } catch { fail(400, "Choose a valid deadline in Eastern time."); }
    if (Date.parse(dueAt) <= Date.now() || Date.parse(dueAt) > Date.now() + 2 * 366 * 86400_000) fail(400, "Choose a future deadline within the next two years.");
    return { title: text(input.title, 160), instructions: text(input.instructions, 8000), dueAt, amountCents: amount(input.amountCents), references: links(input.references ?? []) };
  };
  if (!id) {
    requireOwner();
    if (!/^[a-f0-9-]{36}$/.test(input.id ?? "")) fail(400, "Create a fresh assignment and try again.");
    if (!TEAM.some(p => p.id === input.employeeId && p.id !== "owner") || !JSON.parse(env.TEAM_TOKEN_HASHES)[input.employeeId]) fail(400, "Choose an employee with an active dashboard account.");
    const existing = await db.prepare("SELECT data FROM team_creative_assignments WHERE id = ?").bind(input.id).first();
    if (existing) return { assignment: await withCreativeAdvance(db, JSON.parse(existing.data)), duplicate: true };
    item = { id: input.id, employeeId: input.employeeId, ...terms(), status: "offered", version: 1,
      createdAt: now, updatedAt: now, approvedAt: null, submissions: [], payments: [], history: [] };
    event = "assigned";
  } else {
    const row = await db.prepare("SELECT data FROM team_creative_assignments WHERE id = ?").bind(id).first();
    if (!row) fail(404, "Creative assignment not found.");
    previous = JSON.parse(row.data);
    if (!isOwner && previous.employeeId !== user) fail(404, "Creative assignment not found.");
    if (!Number.isInteger(input.version) || input.version !== previous.version) fail(409, "This assignment changed. Refresh it and review the latest details before trying again.");
    item = { ...previous, version: previous.version + 1, updatedAt: now };
    switch (input.action) {
      case "edit":
        requireOwner();
        if (item.status !== "offered") fail(409, "Only unaccepted offers can be edited. Accepted terms stay with the assignment.");
        Object.assign(item, terms()); event = "updated"; break;
      case "accept": case "decline":
        if (user !== item.employeeId) fail(403, "The assigned employee must respond to their offer.");
        if (item.status !== "offered") fail(409, "This offer already has a response.");
        item.status = input.action === "accept" ? "accepted" : "declined";
        event = input.action === "accept" ? "accepted" : "declined"; break;
      case "submit": {
        if (user !== item.employeeId) fail(403, "Only the assigned employee can submit this work.");
        if (!["accepted", "revision"].includes(item.status)) fail(409, "Accept the offer before submitting, or wait for Smooth’s review.");
        const urls = links(input.links);
        if (!urls.length) fail(400, "Add at least one link to the work you’re submitting.");
        if (item.submissions.length >= 50) fail(400, "This assignment has reached its submission limit. Contact Smooth.");
        item.submissions = [...item.submissions, { id: crypto.randomUUID(), submittedAt: now, links: urls, note: text(input.note ?? "", 4000, false) }];
        item.status = "submitted"; event = "submitted"; break;
      }
      case "revise":
        requireOwner();
        if (item.status !== "submitted") fail(409, "Only submitted work can be sent back for changes.");
        item.status = "revision"; event = "changes requested"; break;
      case "approve":
        requireOwner();
        if (item.status !== "submitted") fail(409, "Review a submission before approving payment.");
        item.status = "approved"; item.approvedAt = now; event = "approved"; break;
      case "cancel":
        requireOwner();
        if (!["offered", "accepted", "submitted", "revision"].includes(item.status)) fail(409, "This assignment is already closed. Approved earnings cannot be cancelled.");
        item.status = "cancelled"; event = "cancelled"; break;
      case "pay": {
        requireOwner();
        if (item.status !== "approved") fail(409, "Approve the submitted work before recording a payout.");
        const amountCents = amount(input.amountCents);
        await reconcileAdvances(db);
        if (amountCents > creativeOwed(await withCreativeAdvance(db, item))) fail(400, "The payout cannot exceed the remaining approved earnings.");
        const method = text(input.method ?? "", 80, false);
        item.payments = [...item.payments, { id: crypto.randomUUID(), amountCents, method, paidAt: now }];
        event = "payment recorded"; break;
      }
      default: fail(400, "Choose an available assignment action.");
    }
  }
  const note = ["revise", "approve", "cancel"].includes(input.action) ? text(input.note ?? "", 4000, false) : "";
  item.history = [...item.history, { id: mutation, event, by: user, at: now, ...(note ? { note } : {}) }];
  // Each item has its own compare-and-swap revision. The notification insert is
  // guarded by this exact mutation, so stale retries cannot duplicate earnings,
  // payouts, submissions or alerts. D1 batches run transactionally.
  const write = previous
    ? db.prepare(`UPDATE team_creative_assignments SET data = ?, version = ?, mutation = ? WHERE id = ? AND version = ?
        AND (? != 'pay' OR COALESCE((SELECT SUM(amount_cents) FROM payroll_advance_allocations WHERE source_kind = 'creative' AND source_id = team_creative_assignments.id),0) + ? <= ?)`)
      .bind(JSON.stringify(item), item.version, mutation, item.id, previous.version, input.action, item.payments.reduce((sum, payment) => sum + payment.amountCents, 0), item.amountCents)
    : db.prepare("INSERT OR IGNORE INTO team_creative_assignments (id, employee_id, version, mutation, data) VALUES (?, ?, ?, ?, ?)")
      .bind(item.id, item.employeeId, item.version, mutation, JSON.stringify(item));
  const name = TEAM.find(p => p.id === item.employeeId).name;
  const recipient = isOwner ? item.employeeId : "owner";
  const title = isOwner ? ({ assigned: "New creative assignment", updated: "Creative assignment updated", approved: "Creative work approved", cancelled: "Creative assignment cancelled", "changes requested": "Changes requested", "payment recorded": "Creative payout recorded" }[event]) : `${name} ${event} creative work`;
  const notification = JSON.stringify({ title, body: `${notificationText(item.title, 160)}. Open Creative Work to see the details.`, target: "creative", targetId: item.id });
  const result = await db.batch([write,
    db.prepare(`INSERT INTO team_notification_events (id, user_id, kind, payload, due_at)
      SELECT ?, ?, 'creative', ?, ? WHERE EXISTS (SELECT 1 FROM team_creative_assignments WHERE id = ? AND mutation = ?)`)
      .bind(mutation, recipient, notification, Date.now(), item.id, mutation),
  ]);
  if (!result[0].meta.changes) fail(409, "This assignment changed. Refresh before trying again.");
  ctx.waitUntil(flushAlerts(env));
  await reconcileAdvances(db);
  return { assignment: await withCreativeAdvance(db, item) };
}
