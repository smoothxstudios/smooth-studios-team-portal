# Event Planner refactor — v2.39.1

Measured October 19, 2026 against v2.39.0. This pass covers Event Planner’s frontend; it does not claim a dashboard-wide speed increase or an overall reduction in source code.

## Code and delivered JavaScript

| Measurement | Before | After | Change |
| --- | ---: | ---: | ---: |
| Main planner component (source bytes) | 26,586 | 18,921 | -28.8% |
| All refactored frontend production source (bytes) | 26,586 | 31,929 | +20.1% |
| JavaScript requested by the browser (bytes) | 1,722,496 | 1,724,070 | +0.09% |
| Same JavaScript, locally gzip-compressed (bytes) | 499,367 | 500,144 | +0.16% |

The main component became smaller through extraction and deduplication. The combined code grew because it now includes a reusable calculation model, cache invalidation, typed editor components, and a separate loading/saving hook. Moving code is not counted as deleting it. Tests, benchmark code, release notes, and this report are excluded from production-source totals. Both browser runs requested six JavaScript files; gzip sizes are calculated locally, not measured HTTP transfer compression. Unreferenced files left in local build output are excluded.

Production source after refactoring:

- `components/event-planner.tsx`: 18,921 bytes
- `components/event-planner/dialog.tsx`: 1,025 bytes
- `components/event-planner/forms.tsx`: 5,696 bytes
- `lib/event-planner-model.mjs`: 3,661 bytes
- `lib/use-event-planner.ts`: 2,626 bytes

## Calculation benchmark

Run `node scripts/benchmark-event-planner.mjs`. The benchmark preserves the prior render calculation path as a reference and verifies equivalent results before measuring. It uses six events, eight people, 24 blocks, 24 work preferences, 24 bookings, and 24 assignments. Each result is the median of 15 alternating trials after three warmups on the same local runtime.

| Workload | Before | After | Less calculation time |
| --- | ---: | ---: | ---: |
| First render’s planner calculations | 7.855 ms | 6.072 ms | 22.7% |
| Five successive planner interactions, including first render | 38.644 ms | 7.044 ms | 81.8% |

Crew-rule evaluations drop from 68 to 48 initially, and from 340 to 48 across the five interactions (85.9% fewer). All eight people are checked for each event once per plan/schedule snapshot and coverage period. Updating source data creates a fresh model; changing coverage replaces that event’s cached results. At most one coverage result per event is retained, avoiding growth while typing new times.

These timings measure synthetic local calculations, not full page rendering, network requests, Google Calendar sync, or physical iPhone performance. Other devices and workloads will differ.

## Validation

- 447 automated tests passed.
- Production GitHub Pages build passed.
- Six mobile browser workflows passed: conflict overrides, Smooth’s flexible availability, overnight day grouping, opening on today, custom crew sizes, and 12-hour time display.
- Tests cover refreshed source data, changed coverage, matching conflict results, search/archives, and existing day-count semantics.

The first full-suite run hit an unrelated Calendar authentication test failure. That test passed in isolation and the full suite passed on rerun; no Calendar authentication code was changed.
