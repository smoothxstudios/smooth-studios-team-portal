# Dashboard second reliability audit — v2.39.3

Date: October 19, 2026 (America/New_York).

This pass followed v2.39.2 and concentrated on unfinished operational-workflow review, alert mutation lifecycles, and unavailable browser storage.

## Findings and fixes

| Area | Confirmed issue | Fix and evidence |
| --- | --- | --- |
| Alerts | Switching tabs while Delete completed discarded the server response, leaving a stale unread badge and losing Undo. Restore and bulk Unread used the same faulty guard. | Guard completed writes by account lifetime rather than list-request lifetime. A delayed-response browser reproduction failed against v2.39.2 with “Alerts, 1 unread” after deletion. The updated build passes delete, restore, and bulk-unread navigation checks. |
| Browser storage | Uncaught appearance reads and writes could crash rendering when storage was unavailable. | Catch storage failures and use device appearance/in-memory changes. Browser test denies access to localStorage, then successfully signs in and renders the dashboard without page errors. |
| Payment workflows | Owner inputs were substituted directly into executable shell text, including commit messages. | Pass inputs through environment variables and quoted shell expansions; use fixed commit messages. Tests execute the actual workflow commands with synthetic shell metacharacters against stub executables and verify literal arguments, without running payment operations. |
| Queued payment workflows | Three workflows checked out their dispatch commit instead of the latest main after waiting in the shared queue. | Mark-paid, override-payment, and match-stripe-payment explicitly check out main. Regression tests verify each configuration. |
| Paid-through dates | Validation accepted normalized impossible dates and compared against UTC today. UI cutoff defaults and limits also used UTC. | Reject impossible dates using a date round trip; compare against the configured studio day. Tests cover invalid month ends, leap years, and the UTC/studio midnight boundary. |
| Payment override CLI | A missing --event flag could be mistaken for the first argument and create an unintended override key. | Require a present flag and value. Tests verify rejection before ledger writes and that the ledger remains unchanged. |

## Verification

- Baseline: 453 passing automated tests. Updated: 458 passing automated tests.
- Actual GitHub Pages production build passed, including TypeScript and static export.
- Desktop and 390 × 844 phone-viewport browser checks passed for delayed alert mutations and blocked storage.
- A reusable phone-viewport browser regression is included at `tests/browser/alerts-navigation.mjs`. Run after the Pages build with Playwright available; optionally set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.
- Synthetic accounts and an in-memory SQLite database were used. External requests are intercepted. Tests sent no real employee alerts, invitations, or payroll transactions.

## Limits

This is another focused audit, not a claim that every line is proven correct. The prior audit's existing lint findings remain outside this batch. A complete manual review of styling, UI primitives, migrations, question content, and the separate production app remains unfinished. Physical iPhone behavior, real Apple push delivery, and real Google consent/RSVP were not exercised. Existing records were not audited or repaired.
