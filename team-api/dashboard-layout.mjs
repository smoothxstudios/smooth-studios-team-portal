import { DEFAULT_DASHBOARD_ORDER, normalizeDashboardOrder, validDashboardOrder } from "../lib/dashboard-layout.mjs";

async function initialize(db) {
  await db.prepare("INSERT OR IGNORE INTO owner_dashboard_layout(id, revision, order_json, updated_at) VALUES(1, 0, ?, ?)")
    .bind(JSON.stringify(DEFAULT_DASHBOARD_ORDER), Date.now()).run();
}

export async function dashboardLayoutRoute({ request, db, user, body, fail }) {
  if (user !== "owner") fail(403, "Only Smooth can customize the owner Home layout.");
  if (new URL(request.url).pathname !== "/dashboard-layout") fail(404, "Home layout action not found.");
  if (request.method === "GET") {
    let row = await db.prepare("SELECT revision, order_json FROM owner_dashboard_layout WHERE id = 1").first();
    if (!row) {
      await initialize(db);
      row = await db.prepare("SELECT revision, order_json FROM owner_dashboard_layout WHERE id = 1").first();
    }
    let order;
    try { order = JSON.parse(row.order_json); } catch { order = null; }
    return { revision: row.revision, order: normalizeDashboardOrder(order) };
  }
  if (request.method === "PATCH") {
    const input = await body(request);
    if (!Number.isSafeInteger(input.revision) || input.revision < 0) fail(400, "Refresh Home before saving its layout.");
    if (!validDashboardOrder(input.order)) fail(400, "Include each Home section once in the layout.");
    await initialize(db);
    const result = await db.prepare("UPDATE owner_dashboard_layout SET revision = revision + 1, order_json = ?, updated_at = ? WHERE id = 1 AND revision = ?")
      .bind(JSON.stringify(input.order), Date.now(), input.revision).run();
    if (!result.meta.changes) fail(409, "The Home layout changed on another device. Refresh before saving your changes.");
    return { revision: input.revision + 1, order: [...input.order] };
  }
  fail(404, "Home layout action not found.");
}
