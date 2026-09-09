# Smooth Studios Productions

Standalone production dashboard with individual username/password accounts, project assignment rules, shot lists and storyboards, uploads, crew checklists, documents, schedules, call sheets, and budgets.

## Accounts

The owner username is `smooth`. The initial existing team accounts are `akiva`, `jordyn`, and `rayne`. The deployment initializes missing accounts from the existing studio portal's protected password secrets; it never resets existing production passwords. There is no public registration. The owner creates accounts, resets temporary passwords, enables or disables accounts, and assigns project access. New accounts and reset passwords require a password change. Password changes sign out other devices. Disabling accounts revokes sessions. The owner's account cannot be disabled from the dashboard.

Better Auth 1.7.3 supplies scrypt password hashing, signed HTTP-only session cookies, origin protection, and database-backed login rate limiting. Project APIs enforce authorization on every request. Legacy ChatGPT headers are ignored. Account roles are determined by the immutable owner account ID; client profile fields cannot grant owner permissions. Contact emails are optional; internal placeholder identifiers ending in `.invalid` are never used for messages. No invitations or emails are sent automatically.

## Deploy

This folder is stored as `production/` in the studio portal repository. Its dedicated GitHub Actions workflow uses the existing `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `DASHBOARD_PASSWORD_*`, and `EMPLOYEE_EMAIL_*` repository secrets. Source contains no passwords or tokens. `node scripts/deploy.mjs` provisions a separate production D1 database, applies append-only migrations, initializes missing accounts, deploys the Worker with static assets, preserves or initializes the session secret, and checks login. It uses a separate R2 bucket where the configured account supports it; otherwise files are persisted in ordered D1 chunks. Existing database chunks remain readable after adding a bucket.

`wrangler.jsonc` contains a placeholder local database ID. The deployment script resolves the real database and writes ignored `wrangler.deploy.json`. Never replace the rental dashboard's database or Worker. Do not expose private project records, uploaded files, user records, password hashes, or session secrets in the public repository.

Run `npm ci`, `npm run typecheck`, `npm run build`, then `npm test`. Tests run the actual Worker in Miniflare and exercise authentication, password changes, account management, access isolation, rate limiting, CSRF rejection, and shared files.

The first deployment uses the account's Workers URL. A custom production subdomain can be added once its DNS/zone is available; update `APP_ORIGIN` to match the chosen origin. No Squarespace or rental domain records are changed by this deployment.
