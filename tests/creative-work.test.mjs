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
test("past creative deadlines accept an omitted or blank brief", async t => {
  const f = await setup(); t.after(() => f.close());
  assert.equal((await f.call("owner", "/health")).data.creativeWorkVersion, 4);
  for (const instructions of [undefined, "", " \n "]) {
    const input = { ...offer(), dueLocal: "2025-10-05T18:00", instructions };
    if (instructions === undefined) delete input.instructions;
    const result = await f.call("owner", "/creative-work", input);
    assert.equal(result.status, 200);
    const item = result.data.assignment;
    assert.equal(item.dueAt, "2025-10-05T22:00:00.000Z");
    assert.equal(item.instructions, "");
    assert.equal(item.status, "offered");
    assert.equal(item.approvedAt, null);
    assert.deepEqual(item.payments, []);
    assert.deepEqual(creativeEarnings([item]).metrics, { paid: 0, owed: 0, projected: input.amountCents });
  }
  assert.equal((await f.call("jordyn", "/creative-work")).data.assignments.length, 3);
});
test("an offer can move to a past deadline and clear its brief while invalid terms remain rejected", async t => {
  const f = await setup(); t.after(() => f.close());
  const original = await create(f);
  const result = await act(f, "owner", original, "edit", { ...offer(), instructions: "", dueLocal: "2025-01-05T18:00" });
  assert.equal(result.status, 200);
  const item = result.data.assignment;
  assert.equal(item.id, original.id);
  assert.equal(item.instructions, "");
  assert.equal(item.dueAt, "2025-01-05T23:00:00.000Z");
  assert.equal(item.version, original.version + 1);
  assert.equal((await act(f, "owner", original, "edit", offer())).status, 409);
  const invalidTerms = [
    { dueLocal: "2025-02-30T18:00" },
    { dueLocal: "" },
    { dueLocal: studioLocal(Date.now() + 3 * 366 * 86400_000) },
    { instructions: {} },
    { instructions: "a".repeat(8001) },
    { title: " " },
  ];
  for (const invalid of invalidTerms) {
    assert.equal((await f.call("owner", "/creative-work", { ...offer(), ...invalid })).status, 400);
    assert.equal((await act(f, "owner", item, "edit", { ...offer(), ...invalid })).status, 400);
  }
  const saved = (await f.call("owner", "/creative-work")).data.assignments;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].dueAt, item.dueAt);
  assert.equal(saved[0].version, item.version);
});
test("older work still requires acceptance, submission, and approval before earning or paying", async t => {
  const f = await setup(); t.after(() => f.close());
  const result = await f.call("owner", "/creative-work", { ...offer(), dueLocal: "2025-10-05T18:00", instructions: "" });
  assert.equal(result.status, 200);
  let item = result.data.assignment;
  const dueAt = item.dueAt;
  assert.equal((await act(f, "owner", item, "approve")).status, 409);
  assert.equal((await act(f, "owner", item, "pay", { amountCents: item.amountCents })).status, 409);
  item = (await act(f, "jordyn", item, "accept")).data.assignment;
  assert.equal(item.status, "accepted");
  item = (await act(f, "jordyn", item, "submit", { links: ["https://example.invalid/older-delivery"] })).data.assignment;
  assert.equal(item.status, "submitted");
  assert.equal(creativeOwed(item), 0);
  const approvalStarted = Date.now();
  item = (await act(f, "owner", item, "approve")).data.assignment;
  assert.equal(item.status, "approved");
  assert.ok(Date.parse(item.approvedAt) >= approvalStarted);
  assert.equal(item.dueAt, dueAt);
  assert.equal(creativeOwed(item), item.amountCents);
  item = (await act(f, "owner", item, "pay", { amountCents: item.amountCents })).data.assignment;
  assert.equal(creativePaid(item), item.amountCents);
  assert.equal(creativeOwed(item), 0);
});
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
  assert.equal((await act(f, "jordyn", item, "submit", { links: ["not-a-link"] })).status, 400);
  item = (await act(f, "owner", item, "edit", { ...offer(), title: "Updated brief" })).data.assignment;
  assert.equal(item.status, "offered");
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

test("physical work can be submitted without links and still requires owner approval", async t => {
  const f = await setup(); t.after(() => f.close());
  for (const extra of [{ note: "Studio setup completed in person" }, { links: [], note: "" }]) {
    let item = await create(f);
    assert.equal((await act(f, "jordyn", item, "submit", extra)).status, 409);
    item = (await act(f, "jordyn", item, "accept")).data.assignment;
    assert.equal((await act(f, "rayne", item, "submit", extra)).status, 404);
    item = (await act(f, "jordyn", item, "submit", extra)).data.assignment;
    assert.equal(item.status, "submitted");
    assert.deepEqual(item.submissions[0].links, []);
    assert.equal(item.submissions[0].note, extra.note);
    assert.equal(creativeOwed(item), 0);
    assert.equal((await act(f, "jordyn", item, "approve")).status, 403);
    item = (await act(f, "owner", item, "revise", { note: "Finish the final setup" })).data.assignment;
    item = (await act(f, "jordyn", item, "submit", { links: [] })).data.assignment;
    assert.equal(item.submissions.length, 2);
    item = (await act(f, "owner", item, "approve")).data.assignment;
    assert.equal(creativeOwed(item), item.amountCents);
  }
});

test('multiple people receive linked private offers with independent earnings and retry-safe alerts', async t => {
  const f = await setup(); t.after(() => f.close());
  const input = { ...offer(), employeeIds: ['jordyn','rayne','akiva'] };
  const result = await f.call('owner','/creative-work',input);
  assert.equal(result.status,200);
  const items = result.data.assignments;
  assert.equal(items.length,3); assert.equal(new Set(items.map(item=>item.groupId)).size,1);
  assert.equal(new Set(items.map(item=>item.id)).size,3);
  assert.equal(creativeEarnings(items).metrics.projected,37500);
  for (const person of input.employeeIds) {
    const list = (await f.call(person,'/creative-work')).data.assignments;
    assert.equal(list.length,1); assert.equal(list[0].employeeId,person);
    assert.equal((await act(f,person,items.find(item=>item.employeeId!==person),'accept')).status,404);
  }
  const retry = await f.call('owner','/creative-work',input);
  assert.equal(retry.data.duplicate,true); assert.equal(retry.data.assignments.length,3);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM team_notification_events').get().n,3);
  let item=items[0];item=(await act(f,'jordyn',item,'accept')).data.assignment;
  item=(await act(f,'jordyn',item,'submit',{links:[]})).data.assignment;
  item=(await act(f,'owner',item,'approve')).data.assignment;
  const all=(await f.call('owner','/creative-work')).data.assignments;
  assert.equal(creativeEarnings(all).metrics.owed,12500);
  assert.equal(all.filter(item=>item.status==='offered').length,2);
  assert.equal((await act(f,'owner',item,'edit',offer())).status,409);
});

test('adding people preserves original terms, prevents duplicate membership and rejects stale edits', async t => {
  const f=await setup();t.after(()=>f.close());
  let original=await create(f);
  original=(await act(f,'jordyn',original,'accept')).data.assignment;
  const result=await act(f,'owner',original,'add-people',{...offer(), employeeIds:['rayne','akiva'], amountCents:5000});
  assert.equal(result.status,200);assert.equal(result.data.assignments.length,3);
  const anchor=result.data.assignment;
  assert.equal(anchor.amountCents,12500);assert.equal(anchor.status,'accepted');
  assert.equal(result.data.assignments.filter(item=>item.amountCents===5000).length,2);
  const before=f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM team_notification_events').get().n;
  assert.equal((await act(f,'owner',original,'add-people',{...offer(),employeeIds:['amia']})).status,409);
  assert.equal((await act(f,'owner',anchor,'add-people',{...offer(),employeeIds:['rayne','amia']})).status,409);
  assert.equal((await f.call('owner','/creative-work')).data.assignments.length,3);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM team_notification_events').get().n,before);
  assert.equal((await act(f,'jordyn',anchor,'add-people',{...offer(),employeeIds:['amia']})).status,403);
  const child=result.data.assignments.find(item=>item.employeeId==='rayne');
  const added=await act(f,'owner',child,'add-people',{...offer(),employeeIds:['amia']});
  assert.equal(added.status,200);
  assert.equal(added.data.assignments[1].groupId,anchor.groupId);
});

test('edited active work requires renewed acceptance and preserves submitted history', async t => {
  const f=await setup();t.after(()=>f.close());
  const item=await submitted(f);
  const result=await act(f,'owner',item,'edit',{...offer(), title:'Updated deliverable',amountCents:15000});
  assert.equal(result.status,200);
  const changed=result.data.assignment;
  assert.equal(changed.status,'offered');assert.equal(changed.amountCents,15000);
  assert.deepEqual(changed.submissions,item.submissions);
  assert.equal(creativeOwed(changed),0);
  assert.equal((await act(f,'owner',changed,'approve')).status,409);
  assert.equal((await act(f,'jordyn',changed,'submit',{links:[]})).status,409);
  assert.equal((await act(f,'owner',item,'edit',offer())).status,409);
  assert.equal((await act(f,'jordyn',changed,'accept')).status,200);
});

test('invalid multi-person selections create neither offers nor notifications', async t => {
  const f=await setup();t.after(()=>f.close());
  for (const employeeIds of [[],['jordyn','jordyn'],['jordyn','owner'],['jordyn','missing'],'jordyn']) {
    assert.equal((await f.call('owner','/creative-work',{...offer(),employeeIds})).status,400);
  }
  const hashes=JSON.parse(f.env.TEAM_TOKEN_HASHES);delete hashes.amia;f.env.TEAM_TOKEN_HASHES=JSON.stringify(hashes);
  assert.equal((await f.call('owner','/creative-work',{...offer(),employeeIds:['jordyn','amia']})).status,400);
  assert.equal((await f.call('owner','/creative-work')).data.assignments.length,0);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM team_notification_events').get().n,0);
});

test('concurrent additions from different people in one work create only one new offer', async t => {
  const f=await setup();t.after(()=>f.close());
  const created=await f.call('owner','/creative-work',{...offer(),employeeIds:['jordyn','rayne']});
  const results=await Promise.all(created.data.assignments.map(item=>act(f,'owner',item,'add-people',{...offer(),employeeIds:['akiva']})));
  assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);
  const all=(await f.call('owner','/creative-work')).data.assignments;
  assert.equal(all.length,3);assert.equal(all.filter(item=>item.employeeId==='akiva').length,1);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM team_notification_events').get().n,3);
});
