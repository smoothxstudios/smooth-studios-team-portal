# Smooth Studios Team Portal

A GitHub-hosted dashboard for Smooth Studios rental schedules, studio revenue, and employee earnings. It reads one dedicated Google Calendar on an hourly schedule, assigns rentals only to employees who accepted the event invitation, and publishes a separate encrypted dashboard for the owner and each employee.

## What it does

- Owner overview: all rental revenue, every employee schedule, payroll owed, paid versus unpaid earnings, and period comparisons.
- Employee overview: upcoming rentals, completed history, projected earnings, earned-but-unpaid amount, paid totals, and weekly/monthly/yearly context.
- Employee assignment: the attendee email must match any email configured for that employee and the attendee response must be `accepted`.
- Earnings: every accepted employee receives 30% of the full rental price. When multiple employees accept, each receives the full 30%.
- Customer payment: `Price:` and `Paid Online:` are parsed as cents and must match exactly. An owner can record an exception through the payment-override GitHub workflow.
- Earned timing: commission becomes earned only after both the rental end time has passed and the customer is fully paid.
- Employee payout: the owner runs **Mark employee earnings paid** and chooses an employee plus a paid-through date.
- Theme: Smooth Studios light and dark modes with a persistent local preference.

## Privacy model

GitHub Pages serves static files, so it cannot protect Calendar data with a traditional server session. This project therefore encrypts each dashboard separately with AES-256-GCM before publication. Password keys are derived in the browser with PBKDF2-SHA256 (310,000 iterations). Only encrypted rental payloads are placed in `public/data`.

Use a private repository whenever the GitHub account plan permits private-repository Pages. If Pages requires a public repository, the deployed data remains encrypted and employee emails are still kept in GitHub Secrets, but source code and the public login screen remain visible.

Never commit `.private/`, Google credentials, Calendar IDs, employee email addresses, or dashboard passwords.

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
| `EMPLOYEE_EMAIL_AKIVA` | Akiva's Google invitation email address(es) |
| `EMPLOYEE_EMAIL_JORDYN` | Jordyn's Google invitation email address(es) |
| `EMPLOYEE_EMAIL_RAYNE` | Rayne's Google invitation email address(es) |
| `DASHBOARD_PASSWORD_OWNER` | Generated owner password |
| `DASHBOARD_PASSWORD_AKIVA` | Generated Akiva password |
| `DASHBOARD_PASSWORD_JORDYN` | Generated Jordyn password |
| `DASHBOARD_PASSWORD_RAYNE` | Generated Rayne password |

The hourly workflow runs at 17 minutes past each hour, refreshes the encrypted payloads, commits them, and deploys the updated GitHub Page.

Each `EMPLOYEE_EMAIL_*` secret accepts one address or multiple comma-separated addresses. Addresses are matched case-insensitively and duplicate entries are ignored. Keep every address in GitHub Secrets rather than committing it to the repository.

## Generate strong passwords

```bash
npm ci
npm run provision
```

This creates four strong passwords and preview dashboards. Passwords are written only to `.private/smooth-studios-passwords.json`, which is ignored by Git. Copy each password into the matching GitHub Secret, then give each employee only their own password. Keep the owner password private.

Use `npm run provision -- --rotate` only when intentionally rotating every dashboard password.

## Owner workflows

- **Mark employee earnings paid**: accepts a paid-through date and either one employee or everyone. It updates the payout ledger, rebuilds encrypted data, and redeploys the site.
- **Override customer payment status**: accepts a Google Calendar event ID and `true`, `false`, or `clear`. This handles exceptions to the exact `Paid Online` = `Price` rule.
- **Sync Smooth Studios Calendar**: runs hourly and can also be started manually.

All write actions require the owner to sign into GitHub and have repository workflow permission.

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
