import assert from "node:assert/strict";
import test from "node:test";
import {
  SCHEDULE_CHANGED_MESSAGE, BLOCK_ALREADY_SAVED_MESSAGE, BLOCK_RETRY_MESSAGE,
  matchingTimeBlock, saveScheduleMutation, scheduleMutationMessage, scheduleMutationError,
} from "../lib/team-schedule-mutations.mjs";

const entry = {
  userId: "jordyn", reason: "Work", startLocal: "2026-10-20T09:00",
  endLocal: "2026-10-20T17:00", repeatUntil: "2026-12-22",
};
const failWith = message => { throw new Error(message); };

test("new time blocks recover from a stale revision using the latest schedule once", async () => {
  const writes = [];
  const updates = [];
  let refreshCount = 0;
  const result = await saveScheduleMutation({
    path: "/blocks", method: "POST", data: entry, revision: 2, userId: "jordyn", isOwner: false,
    write: async revision => { writes.push(revision); return revision === 2 ? failWith(SCHEDULE_CHANGED_MESSAGE) : { revision }; },
    refresh: async () => { refreshCount += 1; return { revision: 3, blocks: [] }; },
    onRefresh: latest => updates.push(latest.revision),
  });
  assert.deepEqual(writes, [2, 3]);
  assert.deepEqual(updates, [3]);
  assert.equal(refreshCount, 1);
  assert.deepEqual(result, { revision: 3 });
});

test("an identical weekly block does not get added again when another tab saved it", async () => {
  const writes = [];
  await assert.rejects(saveScheduleMutation({
    path: "/blocks", method: "POST", data: { ...entry, reason: " Work " },
    revision: 0, userId: "jordyn", isOwner: false,
    write: async revision => { writes.push(revision); return failWith(SCHEDULE_CHANGED_MESSAGE); },
    refresh: async () => ({ revision: 1, blocks: [entry] }),
    onRefresh: () => {},
  }), { message: BLOCK_ALREADY_SAVED_MESSAGE });
  assert.deepEqual(writes, [0], "must not retry a duplicate");
  assert.equal(matchingTimeBlock(entry, { ...entry, reason: " Work " }, "jordyn"), true);
  assert.equal(matchingTimeBlock(entry, { ...entry, repeatUntil: null }, "jordyn"), false);
});

test("employee comparisons use authenticated identity; owner comparisons use selected member", async () => {
  const scenarios = [
    { isOwner: false, userId: "jordyn", data: { ...entry, userId: "rayne" }, duplicate: true },
    { isOwner: true, userId: "owner", data: { ...entry, userId: "rayne" }, duplicate: false },
  ];
  for (const scenario of scenarios) {
    const revisions = [];
    const run = saveScheduleMutation({
      path: "/blocks", method: "POST", revision: 1, ...scenario,
      write: async revision => { revisions.push(revision); return revision === 1 ? failWith(SCHEDULE_CHANGED_MESSAGE) : { revision }; },
      refresh: async () => ({ revision: 2, blocks: [entry] }),
      onRefresh: () => {},
    });
    if (scenario.duplicate) await assert.rejects(run, { message: BLOCK_ALREADY_SAVED_MESSAGE });
    else assert.deepEqual(await run, { revision: 2 });
    assert.deepEqual(revisions, scenario.duplicate ? [1] : [1, 2]);
  }
});

test("assignments, work preferences and deletions never silently retry", async () => {
  for (const [path, method] of [["/assignments", "POST"], ["/assignments/one", "POST"], ["/work-preferences", "POST"], ["/blocks/one", "DELETE"]]) {
    let refreshes = 0;
    await assert.rejects(saveScheduleMutation({
      path, method, data: entry, revision: 1, userId: "jordyn", isOwner: false,
      write: () => failWith(SCHEDULE_CHANGED_MESSAGE),
      refresh: () => { refreshes++; return { revision: 2, blocks: [] }; },
      onRefresh: () => {},
    }), { message: SCHEDULE_CHANGED_MESSAGE });
    assert.equal(refreshes, 0);
  }
});

test("a second conflict and non-revision failures preserve the entered form", async () => {
  const attempts = [];
  await assert.rejects(saveScheduleMutation({
    path: "/blocks", method: "POST", data: entry, revision: 1, userId: "jordyn", isOwner: false,
    write: revision => { attempts.push(revision); return failWith(SCHEDULE_CHANGED_MESSAGE); },
    refresh: async () => ({ revision: 2, blocks: [] }), onRefresh: () => {},
  }), { message: SCHEDULE_CHANGED_MESSAGE });
  assert.deepEqual(attempts, [1, 2]);
  assert.equal(scheduleMutationError("/blocks", new Error(SCHEDULE_CHANGED_MESSAGE)), BLOCK_RETRY_MESSAGE);

  let refreshed = false;
  await assert.rejects(saveScheduleMutation({
    path: "/blocks", method: "POST", data: entry, revision: 1, userId: "jordyn", isOwner: false,
    write: () => failWith("Disconnected"),
    refresh: () => { refreshed = true; return {}; }, onRefresh: () => {},
  }), /Disconnected/);
  assert.equal(refreshed, false);
});

test("mutation feedback remains consistent for existing assignment and availability actions", () => {
  assert.equal(scheduleMutationMessage("/assignments/1", { status: "accepted" }, "POST", {}), "Assignment accepted.");
  assert.equal(scheduleMutationMessage("/assignments/1", { status: "declined" }, "POST", {}), "Assignment declined.");
  assert.equal(scheduleMutationMessage("/blocks", entry, "POST", {}), "Availability saved.");
  assert.equal(scheduleMutationMessage("/work-preferences/1", {}, "DELETE", {}), "Availability entry removed.");
  assert.equal(scheduleMutationMessage("/assignments", {}, "POST", { notification: "Offer created." }), "Offer created.");
  assert.match(scheduleMutationMessage("/assignments", {}, "POST", {}), /next sync/);
  assert.equal(scheduleMutationError("/work-preferences", new Error("Blocked")), "Blocked");
  assert.equal(scheduleMutationError("/blocks", undefined), "Couldn’t save this change.");
});

const offer = { id: 'one', employeeId: 'rayne', appointmentId: 'rental', title: 'Studio A Rental', instructions: '',
  start: '2026-12-20T18:00:00Z', end: '2026-12-20T19:00:00Z', createdAt: '2026-11-13T17:00:00Z', status: 'pending' };
function responseOptions(overrides = {}) {
  return { path: '/assignments/one', method: 'POST', data: { status: 'accepted' }, revision: 1, userId: 'rayne', isOwner: false,
    assignments: [offer], onRefresh: () => {}, ...overrides };
}

test('an unrelated update or new conflict approval allows one revision-safe response retry', async () => {
  const writes = [], shown = [];
  const latest = { revision: 3, assignments: [{ ...offer, conflictOverride: { approvedBy: 'owner', start: offer.start, end: offer.end } }] };
  const result = await saveScheduleMutation(responseOptions({
    write: async revision => { writes.push(revision); return revision === 1 ? failWith(SCHEDULE_CHANGED_MESSAGE) : { saved: true }; },
    refresh: async () => latest, onRefresh: fresh => shown.push(fresh),
  }));
  assert.deepEqual(writes, [1, 3]); assert.deepEqual(shown, [latest]); assert.equal(result.saved, true);
});

test('response recovery does not accept changed times, instructions, reassigned or cancelled offers', async () => {
  for (const change of [{ start: '2026-12-21T18:00:00Z' }, { end: '2026-12-20T20:00:00Z' },
    { instructions: 'Different work' }, { employeeId: 'jordyn' }, { status: 'cancelled' }, { status: 'declined' }]) {
    let writes = 0;
    await assert.rejects(saveScheduleMutation(responseOptions({
      write: async () => { writes++; return failWith(SCHEDULE_CHANGED_MESSAGE); },
      refresh: async () => ({ revision: 2, assignments: [{ ...offer, ...change }] }),
    })), /offer changed/);
    assert.equal(writes, 1);
  }
});

test('lost or duplicate acceptance responses are reconciled by reading without writing twice', async () => {
  for (const message of [SCHEDULE_CHANGED_MESSAGE, 'Couldn’t confirm the request.', 'Only the assigned employee can respond to a pending offer.']) {
    let writes = 0;
    const result = await saveScheduleMutation(responseOptions({
      write: async () => { writes++; return failWith(message); },
      refresh: async () => ({ revision: 2, assignments: [{ ...offer, status: 'accepted' }] }),
    }));
    assert.equal(result.alreadySaved, true); assert.equal(writes, 1);
  }
});

test('uncertain saves and actual conflicts are never replayed; a second revision race stops', async () => {
  for (const message of ['Couldn’t confirm the request.', 'This time conflicts with Class.', SCHEDULE_CHANGED_MESSAGE]) {
    let writes = 0;
    await assert.rejects(saveScheduleMutation(responseOptions({
      write: async () => { writes++; return failWith(message); },
      refresh: async () => ({ revision: 2, assignments: [offer] }),
    })), { message });
    assert.equal(writes, message === SCHEDULE_CHANGED_MESSAGE ? 2 : 1);
  }
});
