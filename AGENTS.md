# Dashboard release tracking

The owner wants a visible version and retrospective notes for every dashboard fix or upgrade.

- For each published batch of dashboard code, UI, scheduling, notification, or payment-logic changes, increment the app version and prepend a dated entry to `config/dashboard-releases.json`.
- Keep `currentVersion`, the newest entry's `version`, `package.json`'s version, and both root version fields in `package-lock.json` identical. Patch bumps are appropriate for fixes and small improvements; group related edits shipped together into one release.
- Write short, user-facing notes explaining the resulting behavior. Use the actual release date in `America/New_York`. Preserve previous entries; do not rewrite old updates to sound like new changes.
- Earlier entries without a version are retrospective notes verified against the repository commits listed in each entry. Do not invent historical release numbers. Add the relevant commit references to historical entries when backfilling.
- Never include passwords, tokens, private guideline answers, client information, individual pay amounts, or other private business data in these public notes.
- Routine Calendar/Stripe data refreshes, payroll ledger updates, team activation, and guideline content publications are not app releases and must not bump the version. Production-only changes retain their separate deployment process; do not change that app just to update this footer.
- The version footer is shared by sign-in and the owner/employee dashboard. Keep it small, keyboard-accessible, and usable on mobile. Existing history remains searchable through What changed.
- Both build commands validate the release metadata. Verify the actual GitHub Pages build before publishing. Preserve concurrent data commits and do not migrate the existing GitHub Pages hosting.
