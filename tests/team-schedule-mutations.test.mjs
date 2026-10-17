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
