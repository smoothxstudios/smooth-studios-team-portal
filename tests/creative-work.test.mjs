import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers/notification-fixture.mjs";
import { creativeEarnings, creativeOwed, creativePaid, moneyInputCents } from "../lib/creative-work.mjs";
import { studioLocal } from "../lib/team-schedule.mjs";

const offer = () => ({ id: crypto.randomUUID(), employeeId: "jordyn", title: "Synthetic recap edit", instructions: "Deliver a finished video and source file.", references: ["https://example.invalid/brief"], dueLocal: studioLocal(Date.now() + 7 * 86400_000), amountCents: 12500 });
async function setup() { const f = await fixture(); delete f.env.VAPID_JWK; return f; }
async function create(f) { const result = await f.call("owner", "/creative-work", offer()); assert.equal(result.status, 200); return result.data.assignment; }
const act = (f, user, item, action, extra = {}) => f.call(user, `/creative-work/${item.id}`, { action, version: item.version, ...extra }, "PATCH");
async function submitted(f) {
  let item = await create(f);
  item = (await act(f, "jordyn", item, "accept")).data.assignment;
  return (await act(f, "jordyn", item, "submit", { links: ["https://example.invalid/delivery"], note: "First cut" })).data.assignment;
}
test("creative work is private, owner-assigned, and unrelated to Calendar payroll", async () => {
  const f = await setup();
  assert.equal((await f.call("jordyn", "/creative-work", offer())).status, 403);
  assert.equal((await f.call("sync", "/creative-work")).status, 403);
  const item = await create(f);
  assert.equal((await f.call("owner", "/creative-work")).data.assignments.length, 1);
  assert.equal((await f.call("jordyn", "/creative-work")).data.assignments.length, 1);
  assert.deepEqual((await f.call("rayne", "/creative-work")).data.assignments, []);
  assert.equal((await act(f, "rayne", item, "accept")).status, 404);
  assert.equal((await act(f, "owner", item, "accept")).status, 403);
  assert.deepEqual((await f.call("sync", "/sync/accepted")).data.assignments, []);
  assert.deepEqual(creativeEarnings([item]).metrics, { paid: 0, owed: 0, projected: 12500 });
  f.close();
});
test("submission, revisions, approval, and partial payouts create a single consistent earning", async () => {
  const f = await setup();
  let item = await submitted(f);
  assert.equal(creativeOwed(item), 0);
  assert.equal((await act(f, "jordyn", item, "approve")).status, 403);
  item = (await act(f, "owner", item, "revise", { note: "Shorten the opening" })).data.assignment;
  assert.equal(item.status, "revision");
  assert.equal(item.history.at(-1).note, "Shorten the opening");
  item = (await act(f, "jordyn", item, "submit", { links: ["https://example.invalid/final"] })).data.assignment;
  assert.equal(item.submissions.length, 2);
  const beforeApproval = item;
  item = (await act(f, "owner", item, "approve")).data.assignment;
  assert.equal(creativeOwed(item), 12500);
  assert.equal((await act(f, "owner", beforeApproval, "approve")).status, 409);
  assert.equal((await act(f, "owner", item, "cancel")).status, 409);
  assert.equal((await act(f, "jordyn", item, "pay", { amountCents: 12500 })).status, 403);
  assert.equal((await act(f, "owner", item, "pay", { amountCents: 12501 })).status, 400);
  const beforePay = item;
  item = (await act(f, "owner", item, "pay", { amountCents: 5000, method: "Synthetic transfer" })).data.assignment;
  assert.equal((await act(f, "owner", beforePay, "pay", { amountCents: 5000 })).status, 409);
  assert.equal(creativePaid(item), 5000); assert.equal(creativeOwed(item), 7500);
  item = (await act(f, "owner", item, "pay", { amountCents: 7500 })).data.assignment;
  assert.equal(creativeOwed(item), 0); assert.equal(item.payments.length, 2);
  assert.deepEqual(creativeEarnings([item]).metrics, { paid: 12500, owed: 0, projected: 0 });
  assert.equal((await act(f, "owner", item, "pay", { amountCents: 1 })).status, 400);
  f.close();
});
test("concurrent approvals, submissions, and payments reject stale versions", async () => {
  const f = await setup();
  const item = await submitted(f);
  const responses = await Promise.all([act(f, "owner", item, "approve"), act(f, "owner", item, "approve")]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  const approved = responses.find(r => r.status === 200).data.assignment;
  const pay = await Promise.all([act(f, "owner", approved, "pay", { amountCents: 12500 }), act(f, "owner", approved, "pay", { amountCents: 12500 })]);
  assert.deepEqual(pay.map(r => r.status).sort(), [200, 409]);
  assert.equal((await f.call("jordyn", "/creative-work")).data.assignments[0].payments.length, 1);
  f.close();
});
test("retries, invalid links, invalid amounts and inactive accounts fail safely", async () => {
  const f = await setup(), input = offer();
  const first = await f.call("owner", "/creative-work", input);
  const retry = await f.call("owner", "/creative-work", input);
  assert.equal(retry.data.assignment.id, first.data.assignment.id); assert.equal(retry.data.duplicate, true);
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM team_notification_events").get().n, 1);
  for (const amountCents of [0, -1, 1.5, 10_000_001, "100"]) assert.equal((await f.call("owner", "/creative-work", { ...offer(), amountCents })).status, 400);
  for (const link of ["javascript:alert(1)", "http://example.invalid/", "https://user:password@example.invalid/"]) assert.equal((await f.call("owner", "/creative-work", { ...offer(), references: [link] })).status, 400);
  assert.equal((await act(f, "jordyn", first.data.assignment, "submit", { links: ["https://example.invalid"] })).status, 409);
  const hashes = JSON.parse(f.env.TEAM_TOKEN_HASHES); delete hashes.amia; f.env.TEAM_TOKEN_HASHES = JSON.stringify(hashes);
  assert.equal((await f.call("owner", "/creative-work", { ...offer(), employeeId: "amia" })).status, 400);
  let item = (await act(f, "jordyn", first.data.assignment, "accept")).data.assignment;
  assert.equal((await act(f, "jordyn", item, "submit", { links: [] })).status, 400);
  assert.equal((await act(f, "owner", item, "edit", offer())).status, 409);
  item = (await act(f, "owner", item, "cancel")).data.assignment;
  assert.equal(creativeEarnings([item]).metrics.projected, 0);
  f.close();
});
test("creative earnings use approval year and exact cents", () => {
  const item = { ...offer(), status: "approved", approvedAt: "2027-01-01T04:30:00Z", payments: [{ amountCents: 2500 }], createdAt: "2026-12-28T12:00:00Z" };
  assert.equal(creativeEarnings([item], 2026).metrics.owed, 10000);
  assert.equal(creativeEarnings([item], 2027).metrics.owed, 0);
  assert.equal(creativeEarnings([item], 2026).monthly[11].paid, 2500);
  assert.equal(moneyInputCents("19.99"), 1999);
  for (const invalid of ["1e3", "-1", "2.345", "", "100001", "0"]) assert.equal(moneyInputCents(invalid), null);
});
