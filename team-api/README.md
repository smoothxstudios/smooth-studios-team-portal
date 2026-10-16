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

**Send test** checks only the current device and waits for its push provider’s response. The result appears beside the notification controls, including an HTTP status when rejected; provider acceptance is not proof that the phone displayed the alert. Expired subscriptions are removed, and enabling again repairs subscriptions created with an old push key. The enabled state checks both browser permission and the device registration for the unlocked profile. Assignment forms show whether the selected employee has any devices registered. Calendar sync logs only aggregate registration and retry counts, never endpoints or private notification contents.

The API supports standard Apple, Chrome/FCM, Firefox, and Windows push endpoints. Three devices per profile are allowed. A coalesced durable alert retries transient failures up to four attempts using a five-minute cron. Expired subscriptions are removed. Provider acceptance is not proof of device delivery. The dashboard remains the source of truth even if push is disabled, delayed, or suppressed.

## Security and maintenance

The login derives a purpose-separated HMAC bearer from the existing high-entropy dashboard password. The bearer stays in memory and only its hash is in Worker secrets. A different sync-only bearer cannot use employee or owner UI endpoints. Changing a password requires re-running this deployment as well as the encrypted dashboard sync; rotate both together to revoke old scheduling credentials.

Class reasons are returned only to Smooth and that employee. API snapshots omit contact details, full Calendar descriptions, Stripe details, payment status, and owner workflow tokens. D1 data and push endpoints are private backend records, not files in the public repository. Service workers do not cache private payloads.

All writes use bound SQL. Schedule revisions and atomic conditional batches reject stale/racing mutations. The server rechecks ownership, time bounds, overlaps, and current Calendar data rather than trusting UI controls. No request bodies, credentials, or endpoints are logged by application code.

Apply schema changes with `npx drizzle-kit generate --config team-api/drizzle.config.ts`; review the generated migration, then redeploy with the workflow. Do not drop production tables or replace the existing VAPID secret. Keep the DB binding and database ID unchanged unless intentionally migrating infrastructure.

Tests: `npm test`. Type check: `npx tsc --noEmit`. Worker bundle check: `npx wrangler deploy --dry-run --config team-api/wrangler.jsonc`.
# Availability preferences

`GET /schedule` returns `availabilityVersion: 1` and `workPreferences` for the signed-in employee, or the full team for Smooth. Work preferences are separate from `blocks`: they express interest and never authorize an assignment, override a conflict, or enter rental payroll.

`POST /work-preferences`, `PATCH /work-preferences/:id`, and `DELETE /work-preferences/:id` use the same revision checks as scheduling. Employees can manage only their own entries; Smooth can manage employee entries. Dates and weekly recurrences use Eastern time, including full days spanning daylight-saving changes. Migration `0003_work_preferences.sql` adds a table without changing existing blocks or assignments.

# Temp Check, Daily Quiz, and SmoothStars

Migrations `0004` and `0005` retain the original answer ledger and copy earlier answers into the Medium tier without changing scores or answer snapshots. Migration `0006_paced_quizzes_rewards.sql` adds server-issued quiz offers, reward accounts seeded from existing totals, and an owner adjustment ledger. SQL triggers update balances atomically with new answers or adjustments. Migration `0007_individual_quiz_lookup.sql` indexes daily offers and answers for individual question allocation. Late writes from an older Worker are imported idempotently on access. No scheduling or rental earnings are changed. `/health` advertises `engagementVersion: 4`; deployment checks this capability. The client response format remains `quizVersion: 3`.

- `GET /engagement`: authenticated employee state with `quizVersion: 3`. `quiz` contains today's completed attempts and at most one unanswered, server-issued question. `currentQuestionId`, `available`, `answeredToday`, and `nextQuestionAt` describe the current slot. Future questions and unanswered answer keys are withheld. Refreshing or changing devices keeps the same offered question.
- Question candidates and answer ordering vary by employee. One conditional SQL statement reserves a prompt that has not been offered or answered by anyone that Eastern day, including simultaneous logins. Each tier's bank must contain at least as many distinct prompts as the employee roster. Pre-update unanswered offers are replaced on access only if their prompt was also issued to someone else; this clears that prompt's dismissal so the replacement can appear. Unique pending offers, completed answers, points, and cooldowns are preserved.
- `POST /engagement/mood`: one of six moods plus a UUID `requestId`. Server time starts a three-hour cooldown; conditional transactions prevent duplicates.
- `POST /engagement/dismiss`: `{kind: "mood"}` skips for three hours without recording a mood. `{kind: "question", day, questionId}` acknowledges only that offered question. Employees can reopen it from Home.
- `POST /engagement/answer`: `{day, tier, questionId, optionId}` must match the server-issued snapshot. Correct Easy, Medium, and Very Hard answers earn 5, 10, and 15 points. A first answer is final and retry-safe. The next remaining tier is selected randomly after two elapsed hours from the last answer; no missed intervals accumulate extra immediately available questions. At most one question per tier and three total per Eastern day. A new day starts fresh at Eastern midnight, even during an overnight cooldown.
- `GET /engagement/team`: owner-only scores, recent moods, answers, today's attempts, and adjustment history for active employees. Employees can read only their own state; sync credentials cannot access these routes.
- `POST /engagement/rewards`: owner-only `{requestId, userId, kind, amount, reason}`. `kind: "points"` accepts a nonzero whole number from -10000 to 10000; the resulting balance must stay nonnegative. `kind: "star"` awards one sticker without changing points. Reasons are required, up to 240 characters. Request IDs are idempotent, including concurrent retries; reusing an ID for different content is rejected.

Each 100-point milestone earns a permanent SmoothStar. The account's highest point balance tracks earned milestones so deductions keep stickers, but removing and restoring the same points cannot earn duplicate stickers. The next milestone remains above that highest balance. Directly awarded stars are counted separately and do not move the points goal. Employee views show both the collected total and its breakdown, plus their own recent adjustments.

The server-only question bank mixes camera basics, exposure, studio lighting and equipment, audio, composition, color, photo workflow, and video editing. Explanations link to primary learning resources after grading. Offered and completed questions retain snapshots through later bank updates. This is a learning activity, not a secure examination: the source repository is public. Private studio guideline answers are not included in the bank.

Both quizzes and check-ins use server clocks, including elapsed-time checks over daylight-saving changes. Popups and their tabs appear only on Home. They do not send off-hours push notifications. Correct answers show a reduced-motion-aware celebration. The sidebar contains Road to a SmoothStar and a collected-star count. Check-ins remain optional, private to the employee and Smooth, and unrelated to pay or scheduling. Private records are never committed to GitHub or cached in a service worker.
