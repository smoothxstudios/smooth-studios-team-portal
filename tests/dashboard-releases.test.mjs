import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { releaseHistoryForViewer } from "../lib/dashboard-releases.mjs";
import { dashboardBasePath } from "../lib/site-path.mjs";

const history = JSON.parse(readFileSync(new URL("../config/dashboard-releases.json", import.meta.url), "utf8"));

test("employee update history excludes administration and uses curated copy for mixed updates", () => {
  const notes = [{ id: "admin", date: "2026-10-15", title: "Backend deployment", category: "Accounts", changes: ["Administrative deployment details"] },
    { id: "mixed", date: "2026-10-15", title: "Owner title", category: "Scheduling", changes: ["Worker tokens and backend publishing"], commits: ["abc"],
      employee: { title: "Clearer schedule", changes: ["Accepted assignments are green."] } }];
  const selected = releaseHistoryForViewer(notes, "employee");
  assert.equal(selected.length, 1);
  assert.equal(selected[0].title, "Clearer schedule");
  assert.deepEqual(selected[0].changes, ["Accepted assignments are green."]);
  assert.doesNotMatch(JSON.stringify(selected), /Administrative|Worker tokens|Owner title|commits/);
  assert.deepEqual(releaseHistoryForViewer(notes, "signed-out"), []);
  assert.deepEqual(releaseHistoryForViewer(notes, "unknown"), []);
  assert.deepEqual(releaseHistoryForViewer(notes, "owner"), notes);
});

test("real owner history is complete while employee search content contains no admin-only entries", () => {
  const employee = releaseHistoryForViewer(history.releases, "employee");
  const owner = releaseHistoryForViewer(history.releases, "owner");
  assert.equal(owner.length, history.releases.length);
  for (const id of ["2026-10-14-shared-identity", "2026-09-05-owner-controls", "2026-09-05-stripe", "2026-09-05-category-reporting"]) {
    assert.ok(owner.some(note => note.id === id));
    assert.ok(!employee.some(note => note.id === id));
  }
  assert.ok(employee.some(note => note.id === "2026-10-15-employee-home"));
  assert.doesNotMatch(JSON.stringify(employee), /backend|encrypted|workflow|token|publishing|deploy/i);
  assert.equal(employee[0].version, history.currentVersion);
});

test("custom-domain builds and project-URL builds keep their own asset base paths", () => {
  const github = { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "smoothxstudios/smooth-studios-team-portal" };
  assert.equal(dashboardBasePath(github), "/smooth-studios-team-portal");
  assert.equal(dashboardBasePath({ ...github, GITHUB_PAGES_BASE_PATH: "" }), "");
  assert.equal(dashboardBasePath({ ...github, GITHUB_PAGES_BASE_PATH: "/smooth-studios-team-portal" }), "/smooth-studios-team-portal");
  assert.equal(dashboardBasePath({}), "");
});
