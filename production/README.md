# Smooth Studios Productions

Standalone production dashboard with individual username/password accounts, project assignment rules, shot lists and storyboards, uploads, crew checklists, documents, schedules, call sheets, and budgets.

## Accounts

The owner username is `smooth`. The initial existing team accounts are `akiva`, `jordyn`, and `rayne`. The deployment initializes missing accounts from the existing studio portal's protected password secrets; it never resets existing production passwords. There is no public registration. The owner creates accounts, resets temporary passwords, enables or disables accounts, and assigns project access. Enabled team accounts can enter the workspace but only see productions they are tagged in; the owner can see every production. New accounts and reset passwords require a password change. Password changes sign out other devices. Disabling accounts revokes sessions. The owner's account cannot be disabled from the dashboard.

Better Auth 1.7.3 supplies scrypt password hashing, signed HTTP-only session cookies, origin protection, and database-backed login rate limiting. Project APIs enforce authorization on every request. Legacy ChatGPT headers are ignored. Account roles are determined by the immutable owner account ID; client profile fields cannot grant owner permissions. Contact emails are optional; internal placeholder identifiers ending in `.invalid` are never used for messages. No invitations or emails are sent automatically.

## Deploy

This folder is stored as `production/` in the studio portal repository. Its dedicated GitHub Actions workflow uses the existing `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `DASHBOARD_PASSWORD_*`, and `EMPLOYEE_EMAIL_*` repository secrets. Source contains no passwords or tokens. `node scripts/deploy.mjs` provisions a separate production D1 database, applies append-only migrations, initializes missing accounts, deploys the Worker with static assets, preserves or initializes the session secret, and checks login. It uses a separate R2 bucket where the configured account supports it; otherwise files are persisted in ordered D1 chunks. Existing database chunks remain readable after adding a bucket.

`wrangler.jsonc` contains a placeholder local database ID. The deployment script resolves the real database and writes ignored `wrangler.deploy.json`. Never replace the rental dashboard's database or Worker. Do not expose private project records, uploaded files, user records, password hashes, or session secrets in the public repository.

Run `npm ci`, `npm run typecheck`, `npm run build`, then `npm test`. Tests run the actual Worker in Miniflare and exercise authentication, password changes, account management, tag-restricted project viewing and editing, rate limiting, CSRF rejection, and shared files.

The first deployment uses the account's Workers URL. A custom production subdomain can be added once its DNS/zone is available; update `APP_ORIGIN` to match the chosen origin. No Squarespace or rental domain records are changed by this deployment.

## Project setup, team tags, mobile, and PDF exports

New productions include the shot list and opt in to Crew & Tasks, Scripts & Files, Scheduling & Call Sheet, and Budget & Expenses. Existing productions without a saved section selection retain all sections. Project details can change the selection later; hidden sections keep their data. The studio time zone remains in scheduling data and is no longer a required setup field.

Account administration and the Studio Dashboard link are under Settings. Owners can tag existing active team accounts when creating a project or from Project overview. Tags grant viewing, editing, file access, and PDF export permission even when Crew & Tasks is off. Team accounts only receive summaries and project data for their tagged productions; the owner keeps access to all projects. Direct project, crew, file, and reference image requests enforce the same access rule, including images copied between projects. Inaccessible projects and images return 404 without disclosing their contents. Removing a tag revokes access on the next request. Open workspaces refresh assignments on focus and every 30 seconds and clear a revoked project and its open dialogs. Previously downloaded files cannot be recalled. Project updates, image and file uploads, and file deletion require an assignment (or owner access). No notifications or invitations are sent by tagging.

On phones, shot lists use stacked cards with expandable details; a project section selector replaces horizontal navigation. Filters collapse behind a button, and expense rows become labeled cards. Desktop tables remain available.

PDF export can combine selected productions, produce one PDF per production, or export selected project sections separately. Enabled sections, written scripts, crew, schedules, call sheets, expenses, and optional reference images are included. Uploaded documents are listed by filename; their contents remain separate. The export runs in the signed-in browser and downloads authenticated references without sending project data to another service. The PDF engine loads with the dashboard so open tabs keep working after deployments. Bundled fonts load when exporting. HTML revalidates on refresh; missing assets return 404 rather than the app HTML. Font license is in `public/fonts/LICENSE.txt`.

`npm test` checks server permissions, atomic project creation with tags, optional section persistence, and PDF generation with long text, Unicode names, reference images, and multiple projects.

## Custom category setup and picture uploads

Create project offers standard categories, the current project's categories, or a custom setup. Build fields, choose text/notes/dropdown/number types, edit choices, and choose columns before creating the project. The setup stays in the creation draft until saved.

Reference pictures upload in authenticated 128 KiB parts, with ownership and project editing checks on each request. Retried parts and completion are idempotent. MIME types are detected from bytes, original image bytes are preserved, and failed parts can retry without restarting the entire file. Incomplete uploads expire after 24 hours. Pending parts stay inaccessible until completion. Existing image and file URLs remain valid. Database file reads stream bounded pages, and legacy file writes use bounded batches. Upload failures display clear errors and retain the shot draft.

## Shot List and Shot Breakdown

PDF exports default to the landscape Shot List in shooting order. Multiple shots share each page, with repeated column headings, scene/shot IDs, completion checkboxes, camera and production details, setup/duration, small reference images, and an unruled Notes column. Long fields continue with their shot ID instead of being clipped. Export options also offer scene/shot ordering and the portrait Shot Breakdown. Other selected project sections retain their own readable pages.

Export options have visible PDF Organization, Shot List Layout, and Shot Order labels. Export filenames use one hyphen between words. PDF category labels use title case; inline bold labels and camera-column dividers keep each setting easy to scan.

## Storyboard PDF

Shot List Layout also offers Storyboard: four columns of image cards sized to their content, with scene/shot labels, framing/movement badges, descriptions, status, priority, and editable Notes fields. Existing shot notes and take notes populate the fields; longer descriptions or notes continue on additional cards. Notes follow each description directly. Empty Notes fields stay compact; saved notes expand their field as needed. Multiple rows share a landscape page when they fit. Extra references appear as thumbnails. Missing references are marked, and image exclusion remains available.

Notes use real multiline AcroForm fields with embedded fonts, default form resources, and saved appearances. Notes can be edited and saved in the downloaded PDF; those edits stay in the file and do not change dashboard data. Collections use distinct field names for every card. The export tests save and reopen edited Unicode notes and check form fields, widgets, pagination, and long content.

## Automatic shot numbering

Saving a new Shot # inserts the shot at that position within its scene and renumbers the scene consecutively. Moving a shot between scenes closes the old gap. Numbers beyond the last position place the shot at the end. Shot IDs, reference images, saved notes, and schedule links are preserved. The shot also moves beside its new scene neighbor in filming order unless an explicit filming order was edited. Changes save together under the existing project revision check. Editing other shot details leaves numbering alone.

## Opening Production from Studio Dashboard

The Studio Dashboard links to Production with the signed-in Studio profile's username (`owner` maps to `smooth`). This is a sign-in hint only: Production always verifies its own server session and still enforces project tags. A saved Production session for another username is signed out before the workspace loads. The teammate then enters their own Production password; a matching verified session can continue directly. Missing or malformed account hints require fresh sign-in.

Account changes clear open Production workspaces in other tabs through a same-origin broadcast. Open tabs also recheck their session on focus and periodically, and stale session responses cannot restore a previous account. Data requests carry the tab's verified account ID; the server rejects requests if a different account's cookie becomes active. The sidebar shows the signed-in person's name.
