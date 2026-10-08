# Riento

Riento helps people explore Helsinki nightlife with privacy-first venue-level crowd and music signals. The first version targets Helsinki bars and clubs with a clean dark mobile UI for iOS and Android.

Public branding note:
- The public-facing app name is `Riento`.
- Internal technical identifiers currently remain `mesta` for the Expo slug, URL scheme, and local ShazamKit module names. Store-facing native application identifiers now use `com.riento.app` on Android and iOS.
- Do not rename those identifiers without a separate migration decision.

## Tech Stack
- Expo
- React Native
- TypeScript
- Expo Router
- React Native Maps
- Expo Location
- Expo Audio

## Getting Started
Install dependencies:

```sh
npm install
```

Start the app:

```sh
npm start
```

Run on iOS:

```sh
npm run ios
```

Run on Android:

```sh
npm run android
```

Verify TypeScript:

```sh
npm run typecheck
```

Run the standard project checks:

```sh
npm run verify
```

Generate Supabase venue seed SQL:

```sh
npm run seed:venues:sql
```

Generate one combined Supabase setup file:

```sh
npm run setup:supabase:sql
```

## Running On A Phone
Fastest option:
- Install Expo Go on the phone.
- Run `npm start -- --clear`.
- Scan the QR code from Expo Go.

Android over USB:
- Enable Developer Options and USB debugging on the phone.
- Run `npm run android`.

iPhone note:
- Expo Go can test JavaScript-only flows, but ShazamKit and account-link callback validation require a native development/internal build.
- Use EAS Build for TestFlight/App Store builds.

If a red error screen appears, copy the first 5 to 10 lines of the error. Those lines usually identify the actual cause.

## Project Structure
- `app/(tabs)/index.tsx`: Map page.
- Map markers and selectable search results open a venue card with broad activity, open state, rounded distance, vibe, usual sound, music, and manual placement.
- Map supports typo-tolerant venue/area/street/sound search, kind/activity/sound filters, recentering, a broad activity legend, and a Right now shortcut.
- `app/(tabs)/leaderboard.tsx`: Leaderboard page.
- Leaderboard supports kind/activity/sound filters while keeping exact crowd counts and signal times hidden. Live and Trending require current evidence; authorized admins manage curated venues from Trending plus temporary activity and trusted now-playing entries from venue detail.
- `app/(tabs)/profile.tsx`: Settings, optional review account, privacy, export, and deletion controls.
- `app/report-venue.tsx`: Missing venue report page for private coverage feedback.
- `app/venue/[id].tsx`: Venue detail with dynamic crowd context, one-shot music matching, private venue/song Yes/No feedback, trusted admin song entry, account-free number ratings, moderated account reviews, reporting/blocking, manual placement, and venue reports.
- `src/data/venues.ts`: 122-row Helsinki seed with 117 active venues, 112 reproducible OSM source matches, seven official/operator-source reviewed rows, five closed rows, and reviewed sound tags for priority clubs.
- `scripts/auditVenueOsm.ts`: read-only Overpass drift audit for exact OSM source IDs and opening-hours metadata. Its dev-only standards parser normalizes stable weekly intervals so parser code is not shipped in the mobile bundle.
- `src/lib/venueDiscovery.ts`: abstract activity/sound filters, broad open state, rounded distance, and vibe helpers.
- `src/lib/supabase.ts`: Supabase client configuration.
- `src/context/AuthContext.tsx`: lazy anonymous sessions, optional email/Google/Apple review accounts, ownership-preserving identity linking, and native reset/confirmation callbacks.
- `src/services/socialAuthService.ts`: native Apple/Google credential, nonce, sign-out, and provider-revocation helpers.
- `src/services/venueService.ts`: Supabase venue reads, now-playing reads/private feedback/history, GPS pings, manual check-ins, existing venue reports, and missing venue reports.
- `src/services/adminVenueService.ts`: authenticated `app_admins` Trending placement/removal, temporary activity estimates, and fixed trusted manual now-playing calls; no service-role secret is used by the app.
- `src/services/musicRecognitionService.ts`: provider-neutral venue-specific foreground music-check integration point used after explicit launch-card or detail-screen taps; returns platform/provider-aware statuses and calls the optional native matching modules.
- `modules/mesta-shazamkit`: Apple-only local Expo module for the iOS ShazamKit one-shot matcher. Expo Go does not include this module; native iOS builds stream foreground microphone buffers to ShazamKit in memory only, with no raw-audio file writes or Mesta backend uploads.
- `src/services/profileService.ts`: device-local settings plus direct identity-scoped JSON export and deletion.
- `src/hooks/useVenues.ts`: Venue loading hook with local fallback.
- `src/hooks/useProfileSettings.ts`: Profile settings hook used by Profile and Map.
- `src/hooks/useMusicRecognitionSettings.ts`: device-local foreground music-check prompt preferences.
- `src/lib/crowd.ts`: Crowd level helpers.
- `src/lib/nowPlaying.ts`: Now-playing display helpers.
- `src/theme/`: Shared visual theme and map style.
- `docs/PRIVACY_POLICY.md`: publishable privacy policy text requiring final legal review.
- `docs/PRIVACY_POLICY_DRAFT.md`: working privacy policy draft aligned with the disclosure matrix.
- `docs/TERMS.html`: publishable terms page for release hosting.
- `public/legal`: EAS Hosting source for the Riento homepage, Privacy Policy, Terms, Support, Data Deletion, and Community Guidelines pages.
- `scripts/writeHostedLegalPages.ts`: generates `public/legal` from `index.html` and `docs/*.html`; `npm run verify` rejects stale hosted copies.
- `docs/TERMS_DRAFT.md`: working terms draft aligned with product/legal review.
- `docs/ACCOUNT_DELETION_RUNBOOK.md`: draft admin process for completing account deletion requests.
- `docs/DATA_EXPORT_RUNBOOK.md`: draft admin process for handling data export requests.
- `docs/BUILD_RUNBOOK.md`: draft EAS/internal build and release process.
- `docs/LAUNCH_OPERATIONS.md`: required launch gates, monitoring, incident, backup, kill-switch, moderation, and staged-rollout procedure.
- `docs/VENUE_REPORT_REVIEW_RUNBOOK.md`: draft review process for wrong/missing venue reports.
- `docs/MUSIC_RECOGNITION_RUNBOOK.md`: draft guardrails, native ShazamKit validation steps, and provider requirements for foreground audio matching.
- `docs/REVIEW_MODERATION_RUNBOOK.md`: required written-review queue, SLA, approval/rejection, and enforcement process.
- `docs/COMMUNITY_GUIDELINES.md`: written-review content rules.
- `scripts/setVenueNowPlaying.ts`: trusted admin script for correcting/promoting music reports or setting venue-authorized now-playing rows.
- `scripts/resolveVenueReport.ts`: trusted admin script for marking reviewed private venue reports resolved.
- `scripts/moderateVenueReview.ts`: dry-run-first written-review approval/rejection script.
- `scripts/verifyLaunchReadiness.ts`: read-only production schema, legal, Auth, freshness, permission, and Edge verification.
- `scripts/checkLaunchQueues.ts`: privacy-safe moderation/deletion queue counts and SLA check.
- `scripts/backupSupabase.sh`: encrypted external logical-backup helper; managed Supabase backup/PITR remains primary.
- `docs/STORE_LISTING_DRAFT.md`: draft App Store/Google Play listing copy.
- `docs/GOOGLE_PLAY_SUBMISSION_COPY.md`: Android-only Google Play listing and review notes.
- `docs/APP_PRIVACY_DISCLOSURES_DRAFT.md`: draft app privacy/data safety disclosure notes.
- `supabase/schema.sql`: MVP database schema and RLS policies.
- `supabase/seed_venues.sql`: Generated provisional Helsinki venue seed.
- `supabase/schedule_crowd_snapshots.sql`: Supabase cron schedule for crowd label refreshes.
- `supabase/setup_all.sql`: Generated one-file Supabase setup for the SQL editor.
- `COPY_AND_PASTE.md`: Commands and dashboard actions for the user to run manually.
- `eas.json`: EAS build profiles for internal preview and production builds.
- `ROADMAP.md`: Launch roadmap.
- `AGENTS.md`: Project context for future coding agents.

## Privacy Direction
Riento uses foreground-only location, broad venue-level crowd labels, and no public individual locations or exact counts. Account-free contributions use a private pseudonymous session; optional email, Google, and Apple accounts exist only for moderated written reviews. All identity types support direct in-app export/deletion. Music recognition requires an explicit foreground tap, stores no raw audio, and never listens in the background.
