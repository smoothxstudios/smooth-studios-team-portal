# Smooth Studios Team Portal

A GitHub-hosted dashboard for Smooth Studios appointments, studio revenue, and employee earnings. Calendar and Stripe syncing is scheduled every 5 minutes. Employees confirm work by accepting an existing Calendar invitation or an owner-created portal offer, and each person receives a separate encrypted dashboard.

## What it does

- Owner overview: appointment revenue, Stripe gross/refunds/fees/net/bank payouts, revenue by package category, every employee schedule, payroll owed, paid-to-team totals, and period comparisons.
- Employee overview: upcoming appointments, completed history, projected earnings, earned-but-unpaid amount, paid totals, and weekly/monthly/yearly context.
- Appointment categories: Studio Rentals, Studio Packages, Outside, Graduation, Video, Business, Campaign, and a safe Other fallback. Add-ons inherit the main package category from the event title.
- Employee assignment: an accepted Calendar invitation must match a configured employee email; accepted portal offers are merged by appointment ID and time without duplicate commission. Pending offers never count as accepted.
- Earnings: existing employees default to 30% of the appointment price. Jordyn receives 40% for appointments starting September 26, 2026 onward in America/New_York ($20 on a $50 appointment); earlier work retains 30%. A one-time ledger snapshot preserves previously paid amounts and leaves the raise difference outstanding until Smooth marks it paid. Tips never increase the commission base. New hires use their individually selected hourly or percentage rate; unset rates never inherit 30%. Hourly earnings cover accepted studio-rental hours only.
- Customer payment: matched Stripe payments are the preferred source of truth. Acuity IDs are matched first; high-confidence customer email/name, amount, and date matches are used as a fallback. `Paid Online:` remains the fallback when Stripe is not connected or no Stripe payment can be safely matched. Any amount above the price is recorded as a tip. A lower positive amount is a deposit, and a completed appointment with a remaining balance is flagged for review. Smooth can confirm payment received by invoice, cash, Apple Pay, or another method through the payment-override workflow.
- Reconciliation safety: Stripe payments that cannot be confidently tied to one Calendar appointment appear only in Smooth's encrypted **Stripe reconciliation** review list. Smooth can select a payment, search for its Calendar appointment, and confirm the match from the dashboard. Unmatched payments are never silently attached to an employee commission.
- Earned timing: commission becomes earned only after both the appointment end time has passed and the customer is fully paid.
- Employee payout: the owner runs **Mark employee earnings paid** and chooses an employee plus a paid-through date.
- Owner workflow controls: Smooth can sync the Calendar, mark employee payouts, and update customer payment status directly inside the dashboard while seeing queued, running, and completed states.
- Theme: Smooth Studios light and dark modes with a persistent local preference.

## Privacy model

GitHub Pages serves static files, so it cannot protect Calendar data with a traditional server session. This project therefore encrypts each dashboard separately with AES-256-GCM before publication. Password keys are derived in the browser with PBKDF2-SHA256 (310,000 iterations). Only encrypted appointment payloads are placed in `public/data`.

Use a private repository whenever the GitHub account plan permits private-repository Pages. If Pages requires a public repository, the deployed data remains encrypted and employee emails are still kept in GitHub Secrets, but source code and the public login screen remain visible.

Never commit plaintext `.private/` files, Google credentials, Calendar IDs, employee email addresses, or dashboard passwords. New employee emails, individual passwords, and pay setup are stored in owner-encrypted `public/data/team-settings.json`; only Smooth’s encrypted dashboard includes passwords for private handoff. Every new employee still receives a separately encrypted dashboard.

The owner workflow token is encrypted only inside Smooth's dashboard payload. It is never included in an employee payload or the public access-profile file. Treat the owner dashboard password as an administrative credential and rotate the token on its expiration date.

## Calendar description format

The sync understands the exact Acuity-style structure already used by Smooth Studios:

```text
Calendar: Smooth Studios
Name: Customer Name
Phone: +10000000000
Email: customer@example.com
Price: $250.00
Paid Online: $250.00
```

Extra form questions and Acuity text after these fields are ignored. Dollar signs, commas, and two decimal places are supported.

## One-time Google setup

1. In Google Cloud, create a project and enable the Google Calendar API.
2. Create a service account and download its JSON key.
3. Open the dedicated **Smooth Studios** Calendar settings.
4. Share that Calendar with the service account email using **Make changes to events** access so the portal can add studio rental team notes. **See all event details** is sufficient for importing only, but cannot write assignment notes.
5. Copy the Calendar ID from **Integrate calendar**.

The service account only needs this dedicated Calendar. Once team scheduling is active, the sync requests the `calendar.events` scope and patches only its marked rental-team section in event descriptions, with `sendUpdates=none`. It never adds guests or changes event titles, times, prices, or RSVP status. Google Calendar notes show pending versus accepted portal offers; cancelled or declined offers are removed. Custom tasks and other appointment categories are not mirrored. Booking text outside the marked section is preserved, and ETag checks protect concurrent edits. Missing edit access is reported inside Smooth's encrypted dashboard without interrupting payroll imports.

## GitHub repository setup

Create `smoothxstudios/smooth-studios-team-portal` as a private repository and push this project to the `main` branch. Private-repository GitHub Pages requires a GitHub plan that supports it; the source can remain private even while Pages is left disabled. Then:

1. Open **Settings → Pages** and choose **GitHub Actions** as the source.
2. Open **Settings → Secrets and variables → Actions**.
3. Add all secrets in the table below.
4. Run **Sync Smooth Studios Calendar** once from the Actions tab.

| Secret | Value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Entire service-account JSON file |
| `GOOGLE_CALENDAR_ID` | ID of the dedicated Smooth Studios Calendar |
| `STRIPE_RESTRICTED_KEY` | Live restricted Stripe key with read-only access to Charges, Payment Intents, Balance Transactions, and Payouts |
| `EMPLOYEE_EMAIL_AKIVA` | Akiva's Google invitation email address(es) |
| `EMPLOYEE_EMAIL_JORDYN` | Jordyn's Google invitation email address(es) |
| `EMPLOYEE_EMAIL_RAYNE` | Rayne's Google invitation email address(es) |
| `DASHBOARD_PASSWORD_OWNER` | Generated owner password |
| `DASHBOARD_PASSWORD_AKIVA` | Generated Akiva password |
| `DASHBOARD_PASSWORD_JORDYN` | Generated Jordyn password |
| `DASHBOARD_PASSWORD_RAYNE` | Generated Rayne password |
| `DASHBOARD_GITHUB_TOKEN` | Fine-grained token limited to this repository with Actions read/write permission |

The Calendar workflow is scheduled every 5 minutes, refreshes the encrypted payloads and rental team notes, commits the encrypted data, and deploys the updated GitHub Page. GitHub can delay scheduled workflows; the dashboard shows the actual last sync time, and **Sync now** remains available.

Each `EMPLOYEE_EMAIL_*` secret accepts one address or multiple comma-separated addresses. Addresses are matched case-insensitively and duplicate entries are ignored. Keep every address in GitHub Secrets rather than committing it to the repository.

### Enable Stripe reconciliation

1. Open the Stripe Dashboard in live mode, then open **Developers → API keys**.
2. Create a restricted key named **Smooth Studios Team Portal**.
3. Give it read access only to **Charges**, **Payment Intents**, **Balance Transactions**, and **Payouts**. Leave every write permission disabled.
4. Save the key as the GitHub Actions secret `STRIPE_RESTRICTED_KEY`. Never place it in the repository or browser code.
5. Run **Sync Smooth Studios Calendar** once. The owner dashboard will then show Stripe gross payments, refunds, fees, net collections, bank payouts, and unmatched payments.

The Stripe key is optional during deployment. If it is absent, the dashboard continues using the Calendar's `Paid Online:` field exactly as before.

### Enable owner workflow buttons

1. Open GitHub **Settings → Developer settings → Personal access tokens → Fine-grained tokens**.
2. Create a token named **Smooth Portal Workflow Trigger** with an expiration date.
3. Set **Repository access** to **Only select repositories**, then choose `smooth-studios-team-portal`.
4. Under **Repository permissions**, set **Actions** to **Read and write**. Leave every other optional permission at **No access**.
5. Copy the token once and save it as the repository secret `DASHBOARD_GITHUB_TOKEN`.
6. Run **Sync Smooth Studios Calendar** once. The next owner sign-in will include the workflow controls; employee dashboards will not receive the token.

When the token expires, replace only `DASHBOARD_GITHUB_TOKEN` and run one Calendar sync. Dashboard passwords do not need to change.

## Add the four new team members

DaCari, Sorayia, Amia, and Terrill are included in the team roster. In the unlocked owner dashboard, open **Team → Set up private account**. Enter their email addresses, select a pay setup (or leave it unset), and activate the accounts. Strong individual passwords are generated locally and the submitted settings are encrypted with the owner session password before the workflow starts. After the workflow succeeds, refresh and copy each person's password from their team card. The setup does not send emails or calendar invitations.

The activation workflow preserves existing accounts, updates backend authentication, imports Calendar/Stripe, and publishes the new encrypted dashboards. Identical retries are safe; existing activated accounts cannot be silently overwritten. Calendar sync, Studio Guidelines updates, and payroll workflows read the same private settings. Unactivated profiles are omitted from the login picker. Keep the owner password available: it encrypts both the owner dashboard and the private team settings.

## Generate strong passwords

```bash
npm ci
npm run provision
```

This creates four strong passwords and preview dashboards. Passwords are written only to `.private/smooth-studios-passwords.json`, which is ignored by Git. Copy each password into the matching GitHub Secret, then give each employee only their own password. Keep the owner password private.

Use `npm run provision -- --rotate` only when intentionally rotating every dashboard password.

## Owner workflows

### Studio Guidelines

Studio Guidelines groups published answers into eight topics. Search accepts natural phrases, related terms, and common typos, ranks matching guidelines, and shows answer excerpts. It searches published content locally; it does not generate answers or invent studio policies. Existing answers receive conservative formatting cleanup while preserving policy decisions, amounts, timing, exceptions, and links.

Open **Questions to answer** in the owner dashboard, or use the `#guidelines-questions` link. The compact queue replaces the introductory interview panel. It retains the original 91 questions, adds 24 follow-ups, and shows unanswered questions first. Replies such as “not sure” or “answer later” remain in the queue. Filter by topic or answer status, pick a suggested policy or type your own, edit the preview, and select **Save answer & next**. **Save for later** moves a question behind other unanswered questions without saving unfinished typing. Suggested policies are never added automatically.

Everyone can use **Ask a question**, including from search results. These questions persist in the authenticated scheduling backend's D1 database: employees can read their own submissions, and the owner can read all submissions. Identical submissions from one person are deduplicated. A submitted question is marked answered after its answer is published. Each person can have up to 60 open submissions. Suggested questions and published guidelines remain usable when the shared queue is temporarily unavailable.

Saved answer drafts and deferred-question progress are encrypted with the owner session password in this browser's local storage. Save unfinished text before leaving. **Publish saved answers** opens the existing owner workflow confirmation and shares the answers in every activated employee's encrypted dashboard. Reload after the workflow succeeds. If another device has published changes, saved drafts merge unrelated changes and ask which version to keep for conflicting entries. Cosmetic formatting and category updates do not create false conflicts. The publishing workflow also rejects stale revisions.

**Export answers** downloads the owner's published guidelines as `Smooth-Studios-Guidelines.json` for wording review. It contains no credentials or customer records. Reimporting this review file preserves entry IDs and updates matching entries instead of duplicating the book. **Edit or import** also supports direct edits and .txt, .md, or other .json imports. Review imported drafts before publishing. The book supports 200 entries, with a 40 KB limit per encrypted update; updates send only changed entries. No private answers or credentials are placed in the public source code.

### Other controls

- **Mark employee earnings paid**: Smooth chooses a paid-through date in the dashboard. It updates the payout ledger, rebuilds encrypted data, and redeploys the site.
- **Update customer payment**: Smooth chooses an appointment and confirms payment received by invoice, cash, or another method, marks it not fully paid, or clears the manual status.
- **Match Stripe payment**: Smooth selects an unmatched Stripe charge and the Calendar appointment it belongs to. The saved match is reused on every future sync, and multiple charges can be linked to one appointment for deposits and final payments.
- **Sync Calendar and Stripe**: scheduled every 5 minutes and can also be started from the dashboard.

The dashboard verifies that the encrypted workflow token belongs to `smoothxstudios`, triggers the selected GitHub Action, and follows its status through completion. Closing or logging out of the owner dashboard discards the decrypted token from the browser session.

## Dashboard versions and update history

The footer on sign-in and dashboard pages shows the current app version and release date. After sign-in, **What changed** opens searchable notes grouped by topic, back to the August 30, 2026 launch. Employees see explicitly curated visual and day-to-day feature notes. The owner sees the complete history and can preview the employee view. Sign-in itself exposes no history controls. These are public product notes, so never include secrets or private business records.

At the owner's request, earlier milestones now have retrospective version labels: v1 begins with the reporting portal and v2 with live scheduling. New capabilities advance the minor number; fixes advance the patch. Earlier entries are marked retrospective rather than implying that those labels appeared on the original builds. The October 15 correction establishes v2.8.1. Dates use Eastern time.

For each dashboard fix or upgrade, bump the version in `package.json`, both root version fields in `package-lock.json`, and `config/dashboard-releases.json`. Prepend a short release note and retain the earlier entries. Both build commands check that these versions agree. Routine data syncs and business-record updates do not change the app version. See `AGENTS.md` for the release-maintenance rules.

### Custom dashboard address

The application is prepared for `https://dashboard.smoothstudios.co`. GitHub Pages settings must set the custom domain to `dashboard.smoothstudios.co`, and the domain's DNS needs a CNAME with name `dashboard` and target `smoothxstudios.github.io`. Enable HTTPS when GitHub's certificate is ready. Do not change the studio website's root or www records. This Actions-based site does not use a repository CNAME file to configure Pages.

Every Pages build takes `GITHUB_PAGES_BASE_PATH` from `actions/configure-pages`. It remains `/smooth-studios-team-portal` on the original URL and becomes empty for the custom domain; asset paths, favicon, and app manifest follow the same setting. After changing the domain, run the dashboard deployment again. The team API allows both exact origins. Sign in again on the new domain, and re-enable push notifications there; browser permissions and local drafts belong to the origin where they were created.

## Local development

```bash
npm ci
npm run provision
npm run dev
```

Useful checks:

```bash
npm test
npm run lint
```

The first import begins at January 1, 2026. Studio timezone, commission rate, display names, and secret-variable names are defined in `config/studio.config.json`.
