# Riento Roadmap

Last updated: 2026-08-02

## Launch Product
- Helsinki bars and clubs on Map, Top, and venue detail screens.
- Public browsing, local My spots/preferences, number ratings, crowd/music contributions, and private venue reports work without visible registration.
- The first server write creates a random private Supabase anonymous session for RLS, cooldowns, export, and deletion.
- Optional email/password, Google, and native iOS Apple accounts exist only for written venue reviews.
- New or edited review text is private until approved; published reviews support Report and Block reviewer.
- A dismissible venue/song check offer starts on for new installs and appears once per cold app process. Foreground location and one-shot music recognition start only after the explicit tap and remain optional in Settings. Existing saved opt-outs remain off; Nearby sorting remains device-only.
- Crowd UI uses broad `No live signal`, Quiet, Active, Busy, and Packed states without exact counts or public signal scores.
- Consumer UI keeps activity timing and launch-estimate provenance abstract; it does not expose exact signal times or distinguish admin launch estimates from other venue activity.
- One accepted device presence remains private; two distinct recent identities publish community Active. Busy/Packed require an authorized temporary admin estimate during launch.
- User venue/song Yes/No feedback and displayed-track confirmations are private. iOS ShazamKit matches stay local unless private feedback is sent; Android ACRCloud matches publish only from the trusted Edge Function after a current venue signal check. Authorized admins can publish manually verified songs as trusted 45-minute entries.
- Raw audio is never stored by Riento and background listening is not allowed.

## Implemented
- Expo Router Map, Top, Settings, venue detail, and missing-venue report flows.
- SecureStore Supabase sessions with concurrency-safe lazy anonymous sign-in.
- Optional email/password, Google, and native iOS Apple accounts; safe anonymous identity linking; confirmation/reset callbacks; provider-aware sign-out/export; and in-app account deletion/revocation.
- Device-local My spots, location/music preferences, direct JSON export, and identity/data deletion.
- Rating/review upsert with one identity per venue, cooldowns, anonymous text rejection, and pending moderation.
- Written-review reporting, author blocking, private author IDs, moderation script, Community Guidelines, and moderation runbook.
- Idempotent crowd writes, one active venue per identity, k=2 community publication, launch-wide/per-venue budgets, 15-minute snapshot buckets, 90-minute expiry, and two-minute reconciliation.
- Trusted Android provider publication, private Yes/No feedback, local-only iOS ShazamKit, authorized-admin manual publication, 45-minute now-playing expiry, and bounded music history.
- Venue/report validation, private provenance, retention cleanup, admin isolation, and direct-table write revocation.
- Evidence-based Live/Trending lists, server-authorized Trending curation, venue-detail temporary activity estimates, activity/sound filters, searchable map results, immediate explicit **Search this area** viewport commits, zoom-dependent activity-biased markers with retained geographic coverage, muted low-clutter iOS Apple Maps, recentering, external walking Directions, and broad open-state/distance/sound context.
- Reproducible OSM source matches for 112 of 117 active venues, current opening metadata, Tavastia coordinate correction, reviewed sound tags for priority clubs, and visible OSM attribution. Official/operator-source review verified Bubbla, Deliberi Keskuskatu, Pien, COTÒ Helsinki, Night Garden, and the current seasonal Set's Backyard and DND pop-ups and closed stale DTM, Remix, Merikerho, and Heidi's rows; remaining provisional operating/editorial data stays subject to operator/user correction.
- Immediate provisional cold-start venues, foreground-aware shared polling, five-minute stable base-row reuse, one reviewed direct cached public-enrichment GET with compatibility RPC, last-good fallback and cache-age readiness, virtualized Top cards, Map/Top accessibility semantics, safe anonymous-to-existing-account switching, and direct review legal links.
- App privacy, terms, support, deletion, store-copy, build, auth, music, and moderation documentation.

## Required Before Release
1. Build new version `0.1.2` Android/iOS artifacts from a clean tagged commit with Android code above 22 and iOS build above 13, then upload to Play internal testing/TestFlight.
2. Run native cold-launch venue/song, permission denial, private feedback, admin trusted-song, auth/deletion, k=2 crowd, music-provider, immediate area-search, activity-biased marker, low-clutter iOS map, Android map-regression, and degraded-backend smoke tests.
3. Resolve the single-machine 500-client Supabase/Cloudflare connect timeout, then pass 500 and 1000-client two-request read bursts with zero failures and p95 below three seconds. Direct cached GETs already pass 10/100 clients at p95 0.55/1.04 seconds.
4. Complete at least 48 hours of controlled pilot testing before percentage-based public rollout.

## Verification Gate
- `npm run verify`
- `npx expo export --platform ios`
- `npx expo export --platform android`
- SQL syntax/dependency review and deployed-object verification
- No service-role/provider secret in the app bundle
- Anonymous sessions cannot submit review text or access admin functions
- Pending/rejected text is not public; approved text is reportable/blockable
- `sample_size` and `signal_score` are inaccessible to app roles
- Same-request crowd/music/rating retries are idempotent
- Account and anonymous deletion remove attributable data
- Anonymous-to-provider linking preserves the exact Auth UUID; provider collisions do not replace it
- Google deletion revokes access and Apple deletion reaches `/auth/revoke`, with clear manual fallback on provider failure

## Deferred
- Background location or listening
- Public profiles, followers, messaging, images, or review replies
- Apple sign-in on Android/web
- Hardware attestation and stronger server-verifiable location proof beyond k=2/global containment
- Venue-authorized Spotify feeds
- Public exact crowd counts or device-level locations
