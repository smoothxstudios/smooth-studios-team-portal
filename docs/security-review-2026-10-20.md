# Dashboard security review — October 20, 2026

Scope: the studio team dashboard, its Cloudflare Worker API, tracked source, deployment configuration, dependency lockfile, and generated GitHub Pages output. Tests used synthetic accounts and an in-memory database. No real staff notifications, payroll changes, or destructive live probes were performed. This is a targeted review, not a guarantee that every vulnerability is absent.

## Confirmed and fixed

- Rental checklist access did not immediately respect explicit staff removals while Calendar data was stale. Reproduced read and write access after removal; regression tests now require an empty rental list and a rejected write. Verified Calendar removal metadata is used to distinguish a later fresh invitation.
- Employee checklist responses included other employees' Calendar acceptance/invitation records. Responses now restrict those fields to the current employee, matching the schedule API.
- No application request throttle was configured. A Cloudflare rate-limit binding now caps requests at 600 per minute per connecting IP per Cloudflare location, before route/database work. Rejections include a one-minute retry hint. This is burst protection, not a global or distributed-attack guarantee. Deployment checks verify the binding is present.
- Updated Next.js, React, React server components, Vite, Cloudflare tooling, and related dependencies. Pinned the patched fflate version used by the alternate build toolchain.

## Checks and evidence

- 472 automated tests pass, including new owner-only endpoint role tests, forged identity fields, cross-origin rejection, invalid/oversized request handling, request throttling, and checklist revocation/privacy regressions.
- Existing tests cover cross-employee creative work, payroll and alert isolation, OAuth state/PKCE/browser binding, encrypted Calendar tokens, push endpoint restrictions, payment concurrency and approved earnings protections.
- Native Worker integration test completes synthetic Google OAuth and invitation operations with unexpected outbound requests rejected. Adapted the test to the updated Miniflare API.
- GitHub Pages production build and alternate preview build succeed. Mobile browser smoke test passes sign-in and creative assignment/create/edit/add-person flows with synthetic data and no page errors. Worker dry-run validates the rate-limit binding.
- Production dependency audit: zero reported vulnerabilities. Full dependency audit fell from 32 to 12 affected-package entries, including transitive parent packages; critical entries fell from one to zero.
- Tracked-file scan found no matches for private-key PEM material, GitHub tokens, live Stripe keys, or Google API keys. This limited pattern scan does not prove that all possible secret formats or repository history are clean.
- Generated GitHub Pages output has no source map files. Public account data is encrypted. Database access occurs through authenticated server routes, not browser database credentials. SQL reviewed uses bound input parameters. User-provided creative/reference links require HTTPS; normal UI text is React-escaped.

## Limitations after the follow-up migration

- Earlier encrypted snapshots may remain in public Git history or caches; already downloaded data cannot be recalled. Current account snapshots and account settings are no longer public website files or new repository commits.
- Password-derived login proofs remain password-equivalent credentials, scoped to session creation and the separate Content Vault identity-only integration. The application uses random expiring session tokens for private data and actions. The separate machine synchronization key remains long-lived and restricted to `/sync/*`.
- The local braces fork needs maintenance until upstream supplies a patched release. A zero-entry npm audit does not independently certify a local fork; its bounded parser/walker behavior is covered by explicit regression tests.
- Hosting-account MFA, repository administrator access, historical secret exposure, Cloudflare account-wide rules, and the separate Production Dashboard/Content Vault were not audited. No claim is made that there has or has not been a past compromise.

## Follow-up: session migration preparation (v2.42.0)

Added random, hashed server sessions with a 30-minute renewal window, a 12-hour
absolute lifetime, per-session sign-out revocation, and credential-change
invalidation. Added account-scoped encrypted snapshot storage; the existing
frontend remains compatible until the coordinated frontend cutover.

Both remaining dependency roots have been addressed. The legacy Drizzle loader
now uses esbuild 0.25.12. No upstream braces fix is published, so all consumers
use the documented local 3.0.3-smooth.1 fork, which bounds parsed nesting and
validates supplied AST depth before recursive traversal. Adversarial nesting,
cyclic ASTs, normal glob patterns and TypeScript transforms are tested. A clean
npm install and all 478 automated tests pass. The full dependency audit reports
zero entries; this includes a locally maintained patch, not an upstream fix.

## Completed migration (v2.42.1)

- Password and quick sign-in now exchange a proof for a random memory-only session. Protected API reads/writes reject the former long-lived dashboard bearer. Sessions renew while the app is visible, expire after 30 minutes without renewal, and cannot outlive 12 hours. Logout deletes the server session; credential changes invalidate existing sessions.
- The frontend clears private data and password/session state on session expiry or a server rejection, with a sign-in message. Delayed responses cannot restore an expired or switched account. Renewal requests are shared; expiry never silently reuses the password to sign in.
- Encrypted account snapshots and team settings are stored in D1. Calendar sync, Studio Guide publication and account activation use authenticated machine routes. Public snapshot files are removed; both builds reject their reintroduction. Missing private guide/settings data fails closed rather than replacing it with empty configuration.
- A compatible backend was deployed and seeded before the frontend cutover. Deployment verification performs read-only sign-ins for active accounts, checks account isolation and renewal, then logs out and confirms revocation. These checks never send staff alerts or change payouts.
- 481 automated tests pass, covering server and browser-session behavior, scoped credentials, stale imports, encrypted storage, concurrent renewal, revocation, cross-account isolation and dependency guards. A synthetic mobile browser flow verifies private data loading, expiry, account switching and logout. Existing creative-work and alerts browser flows are also checked with session sign-in.
- The full dependency audit reports zero findings after a clean install. Removed upstream-only development tooling from the local fork so it cannot bring unused legacy test/build dependencies into the application.
- Targeted lint of new security modules passes. The existing dashboard component still has unrelated React purity/effect lint findings at its time calculations and team-setup effect; the production TypeScript build remains the release gate.
