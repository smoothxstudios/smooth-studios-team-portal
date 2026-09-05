# Smooth Studios Team Portal

A GitHub-hosted dashboard for Smooth Studios appointments, studio revenue, and employee earnings. It reads one dedicated Google Calendar every 30 minutes, assigns appointments only to employees who accepted the event invitation, and publishes a separate encrypted dashboard for Smooth and each employee.

## What it does

- Owner overview: appointment revenue, Stripe gross/refunds/fees/net/bank payouts, revenue by package category, every employee schedule, payroll owed, paid-to-team totals, and period comparisons.
- Employee overview: upcoming appointments, completed history, projected earnings, earned-but-unpaid amount, paid totals, and weekly/monthly/yearly context.
- Appointment categories: Studio Rentals, Studio Packages, Outside, Graduation, Video, Business, Campaign, and a safe Other fallback. Add-ons inherit the main package category from the event title.
- Employee assignment: the attendee email must match any email configured for that employee and the attendee response must be `accepted`.
- Earnings: every accepted employee receives 30% of the full appointment price, whether it is a studio rental or another package. When multiple employees accept, each receives the full 30%.
- Customer payment: matched Stripe payments are the preferred source of truth. Acuity IDs are matched first; high-confidence customer email/name, amount, and date matches are used as a fallback. `Paid Online:` remains the fallback when Stripe is not connected or no Stripe payment can be safely matched. Any amount above the price is recorded as a tip. A lower positive amount is a deposit, and a completed appointment with a remaining balance is flagged for review. Smooth can confirm payment received by invoice, cash, Apple Pay, or another method through the payment-override workflow.
- Reconciliation safety: Stripe payments that cannot be confidently tied to one Calendar appointment appear only in Smooth's encrypted **Stripe reconciliation** review list. They are never silently attached to an employee commission.
- Earned timing: commission becomes earned only after both the appointment end time has passed and the customer is fully paid.
- Employee payout: the owner runs **Mark employee earnings paid** and chooses an employee plus a paid-through date.
- Owner workflow controls: Smooth can sync the Calendar, mark employee payouts, and update customer payment status directly inside the dashboard while seeing queued, running, and completed states.
- Theme: Smooth Studios light and dark modes with a persistent local preference.

## Privacy model

GitHub Pages serves static files, so it cannot protect Calendar data with a traditional server session. This project therefore encrypts each dashboard separately with AES-256-GCM before publication. Password keys are derived in the browser with PBKDF2-SHA256 (310,000 iterations). Only encrypted appointment payloads are placed in `public/data`.

Use a private repository whenever the GitHub account plan permits private-repository Pages. If Pages requires a public repository, the deployed data remains encrypted and employee emails are still kept in GitHub Secrets, but source code and the public login screen remain visible.

Never commit `.private/`, Google credentials, Calendar IDs, employee email addresses, or dashboard passwords.

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
4. Share that Calendar with the service account email using **See all event details** access. Do not give write access.
5. Copy the Calendar ID from **Integrate calendar**.

The service account is read-only. It does not need access to any other Google Calendar.

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

The Calendar workflow runs every 30 minutes, refreshes the encrypted payloads, commits them, and deploys the updated GitHub Page.

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

## Generate strong passwords

```bash
npm ci
npm run provision
```

This creates four strong passwords and preview dashboards. Passwords are written only to `.private/smooth-studios-passwords.json`, which is ignored by Git. Copy each password into the matching GitHub Secret, then give each employee only their own password. Keep the owner password private.

Use `npm run provision -- --rotate` only when intentionally rotating every dashboard password.

## Owner workflows

- **Mark employee earnings paid**: Smooth chooses a paid-through date in the dashboard. It updates the payout ledger, rebuilds encrypted data, and redeploys the site.
- **Update customer payment**: Smooth chooses an appointment and confirms payment received by invoice, cash, or another method, marks it not fully paid, or clears the manual status.
- **Sync Calendar and Stripe**: runs every 30 minutes and can also be started from the dashboard.

The dashboard verifies that the encrypted workflow token belongs to `smoothxstudios`, triggers the selected GitHub Action, and follows its status through completion. Closing or logging out of the owner dashboard discards the decrypted token from the browser session.

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
