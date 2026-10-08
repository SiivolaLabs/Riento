# Supabase Setup

Riento uses Supabase for public venue data, pseudonymous device contributions, and optional email, Google, or Apple review accounts. My spots and app preferences remain local to the device.

## Setup
1. Generate the combined SQL with `npm run setup:supabase:sql`.
2. Run `supabase/setup_all.sql` in the SQL editor for both new and existing projects. It applies schema, seed, and `launch_hardening_final.sql` in one transaction before scheduling cron jobs. Do not apply the cumulative `schema.sql` alone to a live project; the final file must run last so legacy idempotent definitions cannot restore weaker behavior.
3. Enable Authentication > Providers > Anonymous Sign-Ins, manual linking, Email/password with pilot auto-confirm, Google, and Apple. Email ownership is not verified during the pilot; keep account/review abuse controls and monitoring active.
4. Add `mesta://profile` to the Auth redirect allow-list.
5. Configure `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in the app environment.
6. Register Google web/iOS/Android client IDs and Apple native client ID `com.riento.app`; configure the app's public Google client IDs.
7. Deploy `recognize-android-music` with normal JWT verification. Deploy `delete-device-data` with `--no-verify-jwt`; that function manually requires a valid user JWT to create an operation and a hashed 256-bit capability to resume one after Auth deletion.
8. Configure ACRCloud recognition secrets and Apple deletion-revocation secrets only in Supabase.

## Device Sessions
`src/context/AuthContext.tsx` restores an existing session but creates one lazily only on the first server write. Anonymous users use the `authenticated` database role and RLS ownership through `auth.uid()`. Email, Google, and Apple accounts are optional and only unlock written reviews. New provider identities link onto the anonymous UUID; an identity already owned by another account never replaces it silently. Venue/song Yes/No feedback remains attributable and private, while trusted manual music publication independently requires a permanent `app_admins` account inside the RPC.

## Crowd
`submit_venue_signal()` serializes writes per device session, treats an immediate same-venue retry as success, enforces a two-minute renewal cooldown, and replaces the previous active venue. One signal remains private; two recent distinct identities publish community `Active`. Community data cannot publish Busy/Packed during launch. Authorized temporary admin estimates can publish higher levels. The write path upserts one 15-minute bucket without a full venue rescan; the two-minute cron performs exact reconciliation.

App roles can read `crowd_level`, `has_signal`, and 15-minute-bucketed snapshot times. They cannot select `sample_size` or `signal_score`.

Consumer screens intentionally do not display exact signal times or distinguish authorized launch estimates from other activity. Admin signal provenance remains private.

## Public Venue Reads
`build_public_venue_enrichment_payload()` combines the existing coarse crowd, now-playing, rating-summary, and curated-Trending RPCs into one explicitly allow-listed JSON response. Only `service_role` can rebuild the RLS-protected singleton cache. Current clients use a direct GET with column-level access only to `payload`; `singleton` remains inaccessible. Public `get_public_venue_enrichments()` remains as a security-invoker compatibility reader for older clients. The existing two-minute crowd job rebuilds the cache, and launch readiness rejects cache age above five minutes. A cold app refresh uses the venue query plus the cache GET, while polls with fresh venue rows use only the cache GET.

## Discovery And Trending
Venue rows persist broad opening metadata, rich vibe, controlled sound tags, and exact source IDs for auditing. `get_curated_trending_venues()` exposes only active public placements. `set_curated_trending_venue()`, `remove_curated_trending_venue()`, and `submit_admin_venue_signal()` require an Auth user allow-listed in `app_admins`; the Trending manager and venue-detail activity controls verify permanent-account access through `get_admin_status()`. Live excludes no-signal venues, while Trending requires either a current broad activity signal or active curation.

## Ratings
The legacy `venue_reviews` table and RPC names remain. Anonymous identities can submit a private 1–5 feedback rating. Public summaries require at least three permanent-account ratings and exclude pending/rejected attached text. Permanent accounts can add up to 700 characters of text; new/edited text starts `pending`, and public reads return it only after operator approval. One identity has one row per venue. `venue_review_reports` and `review_user_blocks` provide private reporting and blocking without exposing author IDs.

Run `npm run admin:moderate-review -- REVIEW_ID <approve|reject> --reason "..."` for a dry run, then add `--confirm-moderation --confirm-review-id REVIEW_ID`. Follow `docs/REVIEW_MODERATION_RUNBOOK.md`.

## Reports
Clients call `submit_venue_report()`; direct report inserts are disabled. The RPC validates reason/shape/length and applies a cooldown.

## Music
`submit_venue_music_report()` accepts only private confirmation of the currently displayed track and never changes public now-playing/history. iOS ShazamKit matches remain local. Android recognition claims a single-use rate-limited attempt; the trusted Edge Function publishes ACRCloud-returned metadata through service-role-only `publish_provider_music_match()` after checking a current venue signal.

## Data Controls
Settings exports the current identity's RLS-readable contributions and account-provider names as JSON. `delete-device-data` handles anonymous and permanent accounts through a service-only recoverable operation ledger, deletes attributable rows, attempts bounded Apple authorization revocation, deletes the Auth user, and refreshes crowd snapshots. Bounded Google revocation runs in the native client only after Riento deletion is terminal. Service-role and Apple signing keys stay only in Supabase.

## Retention
The scheduled cleanup removes expired raw crowd signals, crowd snapshots older than 7 days, expired now-playing rows, music observations older than 35 days, private music reports older than 90 days, recognition-attempt rows older than 7 days, resolved written-review reports after 90 days, and completed deletion capabilities after 400 days. Completed deletion rows retain no Auth UUID or Apple subject.

## Verification
- Anonymous sign-in succeeds and `is_anonymous=true`.
- Anonymous review text is rejected; anonymous number ratings succeed as private feedback.
- Permanent-account text starts pending, is private before approval, and appears after moderation.
- One identity/venue rating-review row remains after an update.
- Review report and block actions hide no author identity from the database boundary and blocked authors disappear from that identity's reads.
- One crowd signal remains private; a second distinct identity upserts community Active without appending another bucket row; cron reconciles moves within two minutes.
- Missing/invalid reports fail server validation.
- Client-provided audio matches are rejected; Android provider attempt IDs are single-use; confirmations do not create observations.
- `sample_size` and `signal_score` selection fails for anon/authenticated app roles.
- Anonymous users cannot read/administer `app_admins` or admin-only tables.
- Device deletion removes the Auth user and attributable rows.
