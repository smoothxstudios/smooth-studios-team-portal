# Team scheduling backend

This is the separate Cloudflare Worker Smooth created for the existing GitHub Pages portal. It does not replace the Sites project, existing encrypted dashboards, Calendar integration, or Stripe integration.

## Activate once

Repository Actions secrets must include `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and the existing four `DASHBOARD_PASSWORD_*` secrets. The deployment imports Calendar using the existing Google/employee/Stripe secrets too. Never put any secret in source or a workflow input.

After publishing this code, unlock the owner dashboard → **Team Schedule → Activate team scheduling**. Alternatively run **Deploy team scheduling backend** on `main` in GitHub Actions.

Changes to the Worker, shared scheduling modules, or deployment workflow also redeploy automatically on `main`.

The workflow:

1. Tests the code, applies additive D1 migrations to the existing `DB` binding, and deploys `smooth-studios-team-api`.
2. Stores server-side authentication hashes and creates a VAPID signing key only if none exists. Redeployments preserve that key so existing devices continue to work.
3. Imports sanitized Calendar appointments. Only after successful import does it write the public `data/team-api.json` activation flag and republish encrypted dashboards.

The Worker URL is fixed in `lib/team-schedule.mjs`. Its only allowed browser origins are the existing GitHub Pages origin and the existing Sites origin. Rental team notes use the existing Google service account through GitHub Actions; share the dedicated Calendar with that account using **Make changes to events**. No Google credentials are copied into the Worker.

## Use

- All four profiles can block their own time. Smooth can also enter blocks for a selected person. A weekly series uses Eastern local time and has an explicit final date; add separate series for separate class days. A series may start in the past if an upcoming meeting remains. Delete and replace a series to edit it.
- Only Smooth creates or cancels upcoming offers. Known conflicts block the offer unless Smooth explicitly selects **Allow this time conflict**. Existing offers also have an **Allow time conflict** action. The server records the owner approval and its appointment time; duplicate offers and existing Calendar acceptance cannot be bypassed.
- Only the selected employee can accept/decline. Acceptance is required before the appointment starts, even when Smooth approved a conflict. A new conflicting class block prevents acceptance unless the time has an owner override; it never silently cancels agreed work.
- A Calendar time change clears conflict approval and resets an active offer to pending (or cancels it when moved into the past). Missing Calendar appointments cancel their offers. Review notifications in the portal.
- The original Calendar attendee acceptance remains valid. Portal actions never send, remove, or modify Calendar invitations. Reassignment of an accepted Calendar invite still needs that original invitation updated in Calendar.
- Custom tasks are scheduling-only. They never receive automatic rental commissions. Accepted, time-matched portal rentals are merged into the next encrypted sync and deduplicated against Calendar acceptance. Existing 30%, completion, customer payment, and payout-cutoff rules remain in place. Past earnings cannot be cancelled through scheduling.
- Scheduling responses are live; Calendar, Stripe, rental team notes, and financial dashboard syncing is scheduled every 5 minutes. GitHub may delay scheduled runs. Once activated, a failed team import stops encrypted publication instead of dropping portal-earned work. A Calendar note write failure is reported separately without dropping payroll data.
- Studio rental offers are mirrored as a marked description section in the original Calendar event. Pending and accepted states are explicit, cancelled/declined offers are removed, and other appointment categories/custom tasks stay in the portal. Notes contain only employee names and response status, with no class reasons or private instructions. Description patches use `sendUpdates=none` and conditional ETags, preserving booking details and all attendees.

## Notifications

Each person explicitly enables notifications on each device. iPhone/iPad users need a supported OS (16.4+) and the dashboard installed with **Share → Add to Home Screen**, then opened from that icon. Tap **Send test** and check device Focus/notification settings. This device test cannot be replaced by a server build test.

Only generic schedule alerts are sent. No customer details, schedule contents, or class reasons are placed on lock screens or sent in push payloads. Tapping opens the portal, which must be unlocked; accept/decline happens there, not by text. Logging out disables push on that device. Closing the app is fine and does not log out its push subscription.

The API supports standard Apple, Chrome/FCM, Firefox, and Windows push endpoints. Three devices per profile are allowed. A coalesced durable alert retries transient failures up to four attempts using a five-minute cron. Expired subscriptions are removed. Provider acceptance is not proof of device delivery. The dashboard remains the source of truth even if push is disabled, delayed, or suppressed.

## Security and maintenance

The login derives a purpose-separated HMAC bearer from the existing high-entropy dashboard password. The bearer stays in memory and only its hash is in Worker secrets. A different sync-only bearer cannot use employee or owner UI endpoints. Changing a password requires re-running this deployment as well as the encrypted dashboard sync; rotate both together to revoke old scheduling credentials.

Class reasons are returned only to Smooth and that employee. API snapshots omit contact details, full Calendar descriptions, Stripe details, payment status, and owner workflow tokens. D1 data and push endpoints are private backend records, not files in the public repository. Service workers do not cache private payloads.

All writes use bound SQL. Schedule revisions and atomic conditional batches reject stale/racing mutations. The server rechecks ownership, time bounds, overlaps, and current Calendar data rather than trusting UI controls. No request bodies, credentials, or endpoints are logged by application code.

Apply schema changes with `npx drizzle-kit generate --config team-api/drizzle.config.ts`; review the generated migration, then redeploy with the workflow. Do not drop production tables or replace the existing VAPID secret. Keep the DB binding and database ID unchanged unless intentionally migrating infrastructure.

Tests: `npm test`. Type check: `npx tsc --noEmit`. Worker bundle check: `npx wrangler deploy --dry-run --config team-api/wrangler.jsonc`.
