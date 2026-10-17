// Scheduling writes stay revision-safe. Only creation of a new blocked-time
// entry may recover from an outdated schedule; other mutations need review.
export const SCHEDULE_CHANGED_MESSAGE = "The schedule changed. Refresh, review it, and try again.";
export const BLOCK_ALREADY_SAVED_MESSAGE = "This time block is already saved. Check it under Unavailable.";
export const BLOCK_RETRY_MESSAGE = "The schedule updated again while saving. Your entry is still here; tap Save time block to try again.";

export function matchingTimeBlock(block, requested, userId) {
  return block.userId === userId &&
    block.startLocal === requested.startLocal &&
    block.endLocal === requested.endLocal &&
    block.repeatUntil === (requested.repeatUntil ?? null) &&
    block.reason === requested.reason.trim();
}

/**
 * Write using the caller's revision. A rejected new block can be retried once
 * after reading the latest schedule; never retry a successful/uncertain write.
 * Request callbacks are injected so concurrency behavior can be tested without
 * a browser session, while the UI retains ownership of refresh state.
 */
export async function saveScheduleMutation({ path, method, data, revision, userId, isOwner, write, refresh, onRefresh }) {
  try {
    return await write(revision);
  } catch (error) {
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
