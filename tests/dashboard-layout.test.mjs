import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_DASHBOARD_ORDER, normalizeDashboardOrder, validDashboardOrder } from "../lib/dashboard-layout.mjs";
import { dashboardLayoutRoute } from "../team-api/dashboard-layout.mjs";
import { fixture as workerFixture } from "./helpers/notification-fixture.mjs";

const folder = new URL("../team-api/migrations/", import.meta.url);
const migrations = readdirSync(folder).filter(name => name.endsWith(".sql")).sort().map(name => readFileSync(new URL(name, folder), "utf8"));
function fixture(t) {
  const sqlite = new DatabaseSync(":memory:"); migrations.forEach(sql => sqlite.exec(sql)); t.after(() => sqlite.close());
  const db = { prepare(sql) {
    let args = [];
    return { bind(...values) { args = values; return this; }, async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }; } };
  } };
  const call = async (user = "owner", data, method = data === undefined ? "GET" : "PATCH") => {
    const request = new Request("https://api.example.invalid/dashboard-layout", { method,
      ...(data === undefined ? {} : { body: JSON.stringify(data), headers: { "content-type": "application/json" } }) });
    try { return { status: 200, data: await dashboardLayoutRoute({ request, db, user, body: value => value.json(),
      fail: (status, message) => { throw Object.assign(new Error(message), { status }); } }) }; }
    catch (error) { if (!error.status) throw error; return { status: error.status, data: { error: error.message } }; }
  };
  return { sqlite, call };
}

test("layout defaults prioritize upcoming work, and valid saves are exact section permutations", () => {
  assert.deepEqual(DEFAULT_DASHBOARD_ORDER, ["upcoming", "attention", "finances", "hours", "creative", "reports"]);
  assert.equal(validDashboardOrder([...DEFAULT_DASHBOARD_ORDER].reverse()), true);
  for (const order of [null, {}, [], DEFAULT_DASHBOARD_ORDER.slice(1), [...DEFAULT_DASHBOARD_ORDER, "unknown"],
    ["upcoming", "upcoming", "finances", "hours", "creative", "reports"], ["unknown", ...DEFAULT_DASHBOARD_ORDER.slice(1)]]) {
    assert.equal(validDashboardOrder(order), false);
  }
});

test("stored layouts drop obsolete sections, deduplicate, and append future sections without mutating input or defaults", () => {
  const stored = ["hours", "unknown", "upcoming", "hours", "reports", null];
  const before = [...stored];
  const order = normalizeDashboardOrder(stored);
  assert.deepEqual(order, ["hours", "upcoming", "reports", "attention", "finances", "creative"]);
  assert.deepEqual(stored, before);
  order.reverse();
  assert.deepEqual(normalizeDashboardOrder(null), [...DEFAULT_DASHBOARD_ORDER]);
  assert.deepEqual(DEFAULT_DASHBOARD_ORDER, ["upcoming", "attention", "finances", "hours", "creative", "reports"]);
});

test("only the owner can read or change the Home layout", async t => {
  const f = fixture(t);
  const before = f.sqlite.prepare("SELECT * FROM owner_dashboard_layout").get();
  for (const user of [null, "sync", "jordyn", "rayne"]) {
    assert.equal((await f.call(user)).status, 403);
    assert.equal((await f.call(user, { revision: 0, order: [...DEFAULT_DASHBOARD_ORDER].reverse() })).status, 403);
  }
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM owner_dashboard_layout").get(), before);
});

test("a layout persists across requests with an independent revision and cannot overwrite a newer device", async t => {
  const f = fixture(t), order = ["hours", "upcoming", "attention", "finances", "creative", "reports"];
  f.sqlite.prepare("INSERT INTO payroll_advances(id,employee_id,amount_cents,created_at,basis) VALUES(?,?,?,?,?)")
    .run("synthetic-pay-record", "jordyn", 10000, "2026-10-17T12:00:00Z", "unpaid-and-future");
  const payBefore = f.sqlite.prepare("SELECT * FROM payroll_advances").all();
  const state = f.sqlite.prepare("SELECT * FROM team_state WHERE id = 1").get();
  const initial = await f.call(); assert.deepEqual(initial.data, { revision: 0, order: [...DEFAULT_DASHBOARD_ORDER] });
  assert.deepEqual((await f.call("owner", { revision: 0, order })).data, { revision: 1, order });
  assert.deepEqual((await f.call()).data, { revision: 1, order });
  assert.equal((await f.call("owner", { revision: 0, order: [...DEFAULT_DASHBOARD_ORDER].reverse() })).status, 409);
  assert.deepEqual((await f.call()).data, { revision: 1, order });
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM team_state WHERE id = 1").get(), state);
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM payroll_advances").all(), payBefore);
  for (const table of ["team_notification_events", "team_inbox", "team_assignments"])
    assert.equal(f.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
});

test("two devices racing the same revision produce one successful save and one conflict", async t => {
  const f = fixture(t), first = [...DEFAULT_DASHBOARD_ORDER].reverse(), second = ["hours", ...DEFAULT_DASHBOARD_ORDER.filter(id => id !== "hours")];
  const results = await Promise.all([f.call("owner", { revision: 0, order: first }), f.call("owner", { revision: 0, order: second })]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const winner = results.find(result => result.status === 200).data;
  assert.deepEqual((await f.call()).data, winner);
});

test("invalid layout saves are rejected without changing the saved order or revision", async t => {
  const f = fixture(t);
  for (const revision of [undefined, null, -1, "0", 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await f.call("owner", { revision, order: [...DEFAULT_DASHBOARD_ORDER] })).status, 400);
  }
  for (const order of [undefined, [], ["upcoming"], [...DEFAULT_DASHBOARD_ORDER, "unknown"],
    ["upcoming", "attention", "finances", "hours", "creative", "creative"]]) {
    assert.equal((await f.call("owner", { revision: 0, order })).status, 400);
  }
  assert.deepEqual((await f.call()).data, { revision: 0, order: [...DEFAULT_DASHBOARD_ORDER] });
});

test("GET normalizes old or corrupt stored layouts without changing their revision or overwriting preferences", async t => {
  const f = fixture(t);
  for (const value of [JSON.stringify(["hours", "unknown", "hours"]), "invalid json", "null"]) {
    f.sqlite.prepare("UPDATE owner_dashboard_layout SET revision=4, order_json=?").run(value);
    const result = await f.call(); assert.equal(result.status, 200); assert.equal(result.data.revision, 4);
    assert.equal(validDashboardOrder(result.data.order), true);
    assert.equal(f.sqlite.prepare("SELECT order_json FROM owner_dashboard_layout").get().order_json, value);
  }
});

test("a missing owner preference row initializes safely to revision zero", async t => {
  const f = fixture(t); f.sqlite.exec("DELETE FROM owner_dashboard_layout");
  assert.deepEqual((await f.call()).data, { revision: 0, order: [...DEFAULT_DASHBOARD_ORDER] });
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM owner_dashboard_layout").get().count, 1);
});

test("authenticated Worker routing exposes layout preferences only to Smooth", async t => {
  const f = await workerFixture(); t.after(async () => { await Promise.all(f.pending); f.close(); });
  assert.equal((await f.call("unknown", "/dashboard-layout")).status, 401);
  assert.equal((await f.call("sync", "/dashboard-layout")).status, 403);
  assert.equal((await f.call("jordyn", "/dashboard-layout")).status, 403);
  assert.equal((await f.call("owner", "/dashboard-layout")).status, 200);
  const order = [...DEFAULT_DASHBOARD_ORDER].reverse();
  assert.deepEqual((await f.call("owner", "/dashboard-layout", { revision: 0, order }, "PATCH")).data, { revision: 1, order });
  assert.equal((await f.call("jordyn", "/dashboard-layout", { revision: 1, order: [...DEFAULT_DASHBOARD_ORDER] }, "PATCH")).status, 403);
  assert.deepEqual((await f.call("owner", "/dashboard-layout")).data, { revision: 1, order });
});
