# Smooth Studios Productions

Standalone production dashboard with individual username/password accounts, project assignment rules, shot lists and storyboards, uploads, crew checklists, documents, schedules, call sheets, and budgets.

## Accounts

The owner username is `smooth`. The initial existing team accounts are `akiva`, `jordyn`, and `rayne`. The deployment initializes missing accounts from the existing studio portal's protected password secrets; it never resets existing production passwords. There is no public registration. The owner creates accounts, resets temporary passwords, enables or disables accounts, and assigns project editing permissions. Every enabled team account can view the workspace and saved productions. New accounts and reset passwords require a password change. Password changes sign out other devices. Disabling accounts revokes sessions. The owner's account cannot be disabled from the dashboard.

Better Auth 1.7.3 supplies scrypt password hashing, signed HTTP-only session cookies, origin protection, and database-backed login rate limiting. Project APIs enforce authorization on every request. Legacy ChatGPT headers are ignored. Account roles are determined by the immutable owner account ID; client profile fields cannot grant owner permissions. Contact emails are optional; internal placeholder identifiers ending in `.invalid` are never used for messages. No invitations or emails are sent automatically.

## Deploy

This folder is stored as `production/` in the studio portal repository. Its dedicated GitHub Actions workflow uses the existing `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `DASHBOARD_PASSWORD_*`, and `EMPLOYEE_EMAIL_*` repository secrets. Source contains no passwords or tokens. `node scripts/deploy.mjs` provisions a separate production D1 database, applies append-only migrations, initializes missing accounts, deploys the Worker with static assets, preserves or initializes the session secret, and checks login. It uses a separate R2 bucket where the configured account supports it; otherwise files are persisted in ordered D1 chunks. Existing database chunks remain readable after adding a bucket.

`wrangler.jsonc` contains a placeholder local database ID. The deployment script resolves the real database and writes ignored `wrangler.deploy.json`. Never replace the rental dashboard's database or Worker. Do not expose private project records, uploaded files, user records, password hashes, or session secrets in the public repository.

Run `npm ci`, `npm run typecheck`, `npm run build`, then `npm test`. Tests run the actual Worker in Miniflare and exercise authentication, password changes, account management, team-wide viewing and assigned-project editing, rate limiting, CSRF rejection, and shared files.

The first deployment uses the account's Workers URL. A custom production subdomain can be added once its DNS/zone is available; update `APP_ORIGIN` to match the chosen origin. No Squarespace or rental domain records are changed by this deployment.

## Project setup, team tags, mobile, and PDF exports

New productions include the shot list and opt in to Crew & Tasks, Scripts & Files, Scheduling & Call Sheet, and Budget & Expenses. Existing productions without a saved section selection retain all sections. Project details can change the selection later; hidden sections keep their data. The studio time zone remains in scheduling data and is no longer a required setup field.

Account administration and the Studio Dashboard link are under Settings. Owners can tag existing active team accounts when creating a project or from Project overview. Tags link team members to productions and grant editing permission even when Crew & Tasks is off. Every signed-in, enabled team account can browse all saved productions, open reference images and project files, and export PDFs. Removing a tag removes editing permission while preserving viewing. Project updates, image and file uploads, and file deletion require an assignment (or owner access). No notifications or invitations are sent by tagging.

On phones, shot lists use stacked cards with expandable details; a project section selector replaces horizontal navigation. Filters collapse behind a button, and expense rows become labeled cards. Desktop tables remain available.

PDF export can combine selected productions, produce one PDF per production, or export selected project sections separately. Enabled sections, written scripts, crew, schedules, call sheets, expenses, and optional reference images are included. Uploaded documents are listed by filename; their contents remain separate. The export runs in the signed-in browser and downloads authenticated references without sending project data to another service. The PDF engine loads with the dashboard so open tabs keep working after deployments. Bundled fonts load when exporting. HTML revalidates on refresh; missing assets return 404 rather than the app HTML. Font license is in `public/fonts/LICENSE.txt`.

`npm test` checks server permissions, atomic project creation with tags, optional section persistence, and PDF generation with long text, Unicode names, reference images, and multiple projects.

## Custom category setup and picture uploads

Create project offers standard categories, the current project's categories, or a custom setup. Build fields, choose text/notes/dropdown/number types, edit choices, and choose columns before creating the project. The setup stays in the creation draft until saved.

Reference pictures upload in authenticated 128 KiB parts, with ownership and project editing checks on each request. Retried parts and completion are idempotent. MIME types are detected from bytes, original image bytes are preserved, and failed parts can retry without restarting the entire file. Incomplete uploads expire after 24 hours. Pending parts stay inaccessible until completion. Existing image and file URLs remain valid. Database file reads stream bounded pages, and legacy file writes use bounded batches. Upload failures display clear errors and retain the shot draft.

## First AD shot sheet

PDF exports default to a landscape first AD sheet in shooting order. Multiple shots share each page, with repeated column headings, scene/shot IDs, completion checkboxes, camera and production details, setup/duration, small reference images, and writing lines for takes. Long fields continue with their shot ID instead of being clipped. Export options also offer scene/shot ordering and the existing detailed portrait breakdown. Other selected project sections retain their own readable pages.
