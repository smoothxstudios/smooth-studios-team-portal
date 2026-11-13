// Scheduling writes stay revision-safe. An unchanged offer response or a new
// blocked-time entry may recover once from an outdated schedule.
export const SCHEDULE_CHANGED_MESSAGE = "The schedule changed. Refresh, review it, and try again.";
export const BLOCK_ALREADY_SAVED_MESSAGE = "This time block is already saved. Check it under Unavailable.";
export const BLOCK_RETRY_MESSAGE = "The schedule updated again while saving. Your entry is still here; tap Save time block to try again.";
export const OFFER_CHANGED_MESSAGE = "This offer changed. Review its latest details before responding.";

function sameOffer(a, b) {
  return Boolean(a && b && ['id', 'employeeId', 'appointmentId', 'title', 'instructions', 'start', 'end', 'createdAt']
    .every(key => (a[key] ?? '') === (b[key] ?? '')));
}

export function matchingTimeBlock(block, requested, userId) {
  return block.userId === userId &&
    block.startLocal === requested.startLocal &&
    block.endLocal === requested.endLocal &&
    block.repeatUntil === (requested.repeatUntil ?? null) &&
    block.reason === requested.reason.trim();
}

/**
 * Write using the caller's revision. Retry only a definite revision rejection.
 * After an uncertain response, a read may confirm success but cannot retry it.
 * Request callbacks are injected so concurrency behavior can be tested without
 * a browser session, while the UI retains ownership of refresh state.
 */
export async function saveScheduleMutation({ path, method, data, revision, userId, isOwner, assignments = /** @type {import("./team-api").TeamAssignment[]} */ ([]), write, refresh, onRefresh }) {
  try {
    return await write(revision);
  } catch (error) {
    const original = assignments.find(item => path === `/assignments/${item.id}`);
    const responding = method === 'POST' && !isOwner && original?.employeeId === userId &&
      original.status === 'pending' && ['accepted', 'declined'].includes(data.status) &&
      Object.keys(data).every(key => key === 'status');
    if (responding) {
      let latest;
      try { latest = await refresh(); } catch { throw error; }
      onRefresh(latest);
      const current = latest.assignments.find(item => item.id === original.id);
      if (!sameOffer(original, current)) throw new Error(OFFER_CHANGED_MESSAGE);
      // Another tab, or a successful write with a lost response, already saved it.
      if (current.status === data.status) return { saved: true, alreadySaved: true };
      if (current.status !== 'pending') throw new Error(OFFER_CHANGED_MESSAGE);
      if (error instanceof Error && error.message === SCHEDULE_CHANGED_MESSAGE) {
        // Current conflicts and time-bound owner approvals are checked by the API.
        // A second race remains a visible failure and never loops.
        return write(latest.revision);
      }
      throw error;
    }
    if (path !== "/blocks" || method !== "POST" ||
        !(error instanceof Error) || error.message !== SCHEDULE_CHANGED_MESSAGE) throw error;

    const latest = await refresh();
    onRefresh(latest);
    const blockUserId = isOwner ? data.userId : userId;
    if (latest.blocks.some(block => matchingTimeBlock(block, data, blockUserId))) {
      throw new Error(BLOCK_ALREADY_SAVED_MESSAGE);
    }
    // The server still enforces atomic revisions: a second race is surfaced.
    return write(latest.revision);
  }
}

export function scheduleMutationMessage(path, data, method, result) {
  if (result.notification != null) return result.notification;
  if (data.status === "accepted") return "Assignment accepted.";
  if (data.status === "declined") return "Assignment declined.";
  if (data.status === "cancelled") return "Offer cancelled. The person is no longer assigned through this offer.";
  if (path.startsWith("/blocks") || path.startsWith("/work-preferences")) {
    return method === "DELETE" ? "Availability entry removed." : "Availability saved.";
  }
  return "Saved. Calendar notes and rental earnings update on the next sync, scheduled every 5 minutes.";
}

export function scheduleMutationError(path, error) {
  if (path === "/blocks" && error instanceof Error && error.message === SCHEDULE_CHANGED_MESSAGE) {
    return BLOCK_RETRY_MESSAGE;
  }
  return error instanceof Error ? error.message : "Couldn’t save this change.";
}
