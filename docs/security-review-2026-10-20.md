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

## Remaining limitations

- Twelve development-only audit entries remain: eight high-severity entries trace to the braces nested-pattern denial-of-service advisory (the current braces release is still affected); four moderate entries trace to an older esbuild dependency used by Drizzle's legacy loader. These are not in the production dependency audit or the static deployed frontend. Avoid exposing development servers or processing untrusted project/build patterns. Do not downgrade framework tooling merely to satisfy npm's suggested resolution. Recheck when upstream fixes are available.
- The current sign-in architecture uses publicly downloadable, password-encrypted account snapshots and password-derived bearer tokens. Generated passwords use 18 random bytes. Offline password guessing cannot be stopped by API rate limits; strong unique passwords remain essential. Bearers do not have short session expirations; rotation is the revocation mechanism. Quick sign-in protects a local encrypted password with a device passkey rather than replacing API authentication.
- Already downloaded data cannot be recalled by revoking access. Public Git history may retain earlier encrypted snapshots. Moving sensitive snapshots fully behind server authentication would be a separate authentication/data-delivery migration.
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
