const repository = "https://api.github.com/repos/smoothxstudios/smooth-studios-team-portal";
const freshFor = 2 * 60_000, leaseFor = 10 * 60_000;

// Cloudflare's existing five-minute trigger avoids relying on delayed GitHub
// scheduled starts. All writes still run through the serialized sync workflow.
export async function requestBackgroundSync(env, send = fetch, now = Date.now()) {
  if (!env.DASHBOARD_SYNC_TOKEN) return { status: "disabled" };
  const state = await env.DB.prepare("SELECT synced_at FROM team_state WHERE id = 1").first();
  const syncedAt = Date.parse(state?.synced_at) || 0;
  if (syncedAt && now - syncedAt < freshFor) return { status: "fresh" };
  const claim = await env.DB.prepare(`UPDATE dashboard_sync_requests SET requested_at = ?, lease_until = ?, result = 'checking'
    WHERE id = 1 AND requested_at <= ? AND (lease_until <= ? OR requested_at < ?)`)
    .bind(now, now + leaseFor, now - freshFor, now, syncedAt).run();
  if (!claim.meta.changes) return { status: "pending" };
  const headers = { authorization: `Bearer ${env.DASHBOARD_SYNC_TOKEN}`, accept: "application/vnd.github+json", "user-agent": "Smooth-Studios-Sync", "x-github-api-version": "2022-11-28" };
  let status = "unknown", leaseUntil = now + leaseFor;
  try {
    const response = await send(`${repository}/actions/runs?per_page=20`, { headers, redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) { status = "check_failed"; if (response.body) await response.body.cancel(); }
    else {
      const data = await response.json();
      if (!Array.isArray(data.workflow_runs)) throw new Error("Invalid workflow response");
      const running = data.workflow_runs.some(run => [".github/workflows/calendar-sync.yml", ".github/workflows/deploy-team-api.yml"].includes(run.path) && run.status !== "completed");
      if (running) { status = "running"; leaseUntil = now + 5 * 60_000; }
      else {
        const dispatched = await send(`${repository}/actions/workflows/calendar-sync.yml/dispatches`, {
          method: "POST", headers: { ...headers, "content-type": "application/json" }, redirect: "error",
          body: JSON.stringify({ ref: "main" }), signal: AbortSignal.timeout(10_000),
        });
        status = dispatched.status === 204 ? "requested" : "dispatch_failed";
        if (dispatched.body) await dispatched.body.cancel();
      }
    }
  } catch { /* A lost response may have accepted the dispatch: keep the lease. */ }
  if (["check_failed", "dispatch_failed"].includes(status)) leaseUntil = now + 5 * 60_000;
  await env.DB.prepare("UPDATE dashboard_sync_requests SET result = ?, lease_until = ? WHERE id = 1 AND requested_at = ?")
    .bind(status, leaseUntil, now).run();
  return { status };
}
