# Dashboard reliability audit — v2.39.2

Date: October 19, 2026

This audit found and corrected defects in the main Studio Dashboard. It is a targeted manual review plus automated checks, not a completed manual examination of every repository line or a guarantee that no defects remain. The separate Production Dashboard was outside this batch.

## Corrections

| Area | Finding | Correction and evidence |
| --- | --- | --- |
| Google connection | Concurrent callers could decrypt the old connection after another refresh completed, causing a redundant refresh and a false missing-connection result. | Coalesce the entire token read/decrypt/refresh operation per database and account. Twenty concurrent calls now share one connection read and refresh. Regression fails on the previous source. |
| Calendar imports | Full imports could roll back newer snapshots; cleanup deleted other uploads still in progress. | Reject stale explicit read timestamps and active-generation recommits. Cleanup targets only the prior generation and preserves the active generation. Regression fails on the previous source. |
| Calendar staging | A generation could become active between the preflight check and staging write. | The insert also checks the active generation atomically. Full staging uploads are tracked for expiration cleanup. |
| Planner refresh | An unfinished availability note remained in state after its parent dialog closed, keeping automatic refresh paused. | Only visible editor state pauses refresh; reload also clears the note. Verified in the mobile browser with the refresh timer advanced. |
| Planner validation | A local validation failure marked the plan stale and disabled saving until reload. | Validate before starting a server save. Invalid end time can be corrected and saved without losing the draft. |
| Crew coverage | Invalid draft dates could throw during candidate rendering; backwards coverage was still evaluated. | Validate coverage before candidate calculations, show the error, and disable saving until corrected. Browser checks cover a nonexistent DST time and backwards coverage. |
| Planner import | Combining individually valid plans could throw outside the import error handler. | Show merge validation errors inside the existing dialog. |
| Planner save lifecycle | A save could apply its result after the planner had unmounted. | Discard invalidated save results and suppress their completion callbacks. |
| Financial dates | Some period boundaries used device time and fixed-length weeks; owner month grouping used UTC. | Use studio midnight boundaries, calendar weeks across DST, and studio month grouping. Tests cover a 169-hour DST week and a UTC/New York year boundary. |
| Manual pay summaries | Period totals used approval time for manually entered pay instead of its work date. | Use the shared earning-date rule. Rendered component regression verifies prior-week pay stays out of this week's total. |
| Rental checklist endpoint | A staffing change within the same incremental-sync generation could race an authorized checklist save. | Guard the write with schedule revision and template revision as well as generation. Reproduction previously saved successfully; now returns 409 without writing. The current generic checklist UI is unchanged. |

## Verification

- Baseline suite: 447 tests passed.
- Updated suite: 453 tests passed.
- Actual GitHub Pages production build passed, including TypeScript and static export.
- Mobile browser viewport: 390 × 844. Invalid-coverage recovery, validation retry, and refresh after closing a note passed without page errors.
- Existing conflict override and alert-login browser regressions were also run for this batch; release confirmation records their final results.
- Tests used synthetic accounts, appointments, and an in-memory SQLite database. No real employee alert, invitation, or payroll transaction was sent by the test harnesses.

## Coverage and remaining gaps

The inventory contained 314 files under app, components, hooks, lib, team-api, worker, scripts, and tests. Automated lint covered these source areas; the test suite exercised permissions, payroll, scheduling, notifications, Calendar integration, planner rules, and mobile gesture helpers. Manual tracing focused on authentication, request lifecycles, critical write endpoints, sync transactions, and financial date calculations.

The initial lint run reported 38 errors and 20 warnings, primarily existing React hook/compiler rules and JSX apostrophes. This is not a clean lint result; those findings were not mass-suppressed or mechanically rewritten. A full manual review of all styling, UI primitives, operational scripts, question content, migrations, and the separate production app remains outstanding.

Physical iPhone interactions, real Apple push receipt delivery, and real Google consent/RSVP round trips were not tested. Browser emulation and mocked provider responses cannot establish those outcomes. Existing database records were not audited or repaired by these code changes.
