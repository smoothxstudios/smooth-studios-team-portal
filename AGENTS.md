# Dashboard release tracking

The owner wants a visible version and retrospective notes for every dashboard fix or upgrade.

- For each published batch of dashboard code, UI, scheduling, notification, or payment-logic changes, increment the app version and prepend a dated entry to `config/dashboard-releases.json`.
- Keep `currentVersion`, the newest entry's `version`, `package.json`'s version, and both root version fields in `package-lock.json` identical. Patch bumps are appropriate for fixes and small improvements; group related edits shipped together into one release.
- Write short, user-facing notes explaining the resulting behavior. Use the actual release date in `America/New_York`. Preserve previous entries; do not rewrite old updates to sound like new changes.
- The owner requested milestone-based retrospective numbering on October 15, 2026. Version 1 covers the reporting portal, version 2 begins with live scheduling, new capabilities increment the minor number, and fixes increment the patch. The resulting current baseline is v2.8.1. Earlier assigned versions are marked `retrospective: true`; retain that distinction from the package labels originally used. Production-only notes do not change the studio portal version.
- Every note's top-level title and changes form the complete owner history. Supply an explicit `employee` object containing only curated visual and day-to-day feature changes when employees should see that update; omission means owner-only presentation. Filter before searching, counting, and building category choices. Signed-out visitors see only the version and date. Keep the owner preview of employee notes.
- Never include passwords, tokens, private guideline answers, client information, individual pay amounts, or other private business data in these public notes.
- Routine Calendar/Stripe data refreshes, payroll ledger updates, team activation, and guideline content publications are not app releases and must not bump the version. Production-only changes retain their separate deployment process; do not change that app just to update this footer.
- The version footer is shared by sign-in and the owner/employee dashboard. Keep it small, keyboard-accessible, and usable on mobile. Existing history remains searchable through What changed.
- Both build commands validate the release metadata. Verify the actual GitHub Pages build before publishing. Preserve concurrent data commits and do not migrate the existing GitHub Pages hosting.
- All workflows that build Pages must pass `actions/configure-pages`'s `base_path` output as `GITHUB_PAGES_BASE_PATH`. Empty means the custom domain's root; unset falls back to the original project path. Keep `app/layout.tsx` and `next.config.ts` on the shared `dashboardBasePath` helper. Never switch the live domain by changing only a CNAME file.

# Dashboard Help

- Settings → Help is the in-app user guide. For every published user-facing feature or behavior change, update the relevant articles in `lib/dashboard-help.mjs` in the same batch. Add an article when a new task is introduced, remove obsolete instructions, and set changed articles' `updated` date to the release date.
- Use actual page and button labels, plain “How do I…?” titles, short steps, and useful search aliases. Cover owner and employee workflows separately when their screens differ. Never include credentials, access codes, individual pay amounts, or private studio policies in this public source.
- Keep owner instructions filtered out of employee search results and category lists. Retain natural-language, synonym, and typo matching when changing Help search.
- Update Help to describe the resulting behavior, alongside the version notes required above. Routine data refreshes do not need new articles or dates.
