# Music Recognition Runbook

Status: launch-hardened trust boundary. Each cold app session can offer an explicit venue-and-song check. iOS ShazamKit identifies locally but does not publish public metadata. Android ACRCloud publishes only inside the authenticated Edge Function through the service-role-only `publish_provider_music_match()` RPC. User Yes/No feedback is private and cannot create, replace, remove, or extend public now-playing/history. Authorized `app_admins` may publish manually verified songs through a fixed trusted RPC. Apple still issues `com.riento.app` provisioning profiles without `com.apple.developer.shazamkit`, so the signing entitlement stays disabled by default unless Apple starts issuing profiles that include it.

## Current Scaffold
- Profile stores device-local preferences for the music-check prompt.
- Map offers one dismissible **Check venue & song** card per cold process session when both saved settings are enabled. That explicit tap requests foreground location, submits only the matched venue-level signal, and routes to its venue detail screen.
- Venue detail starts the one-shot music check only after that explicit launch-card tap or a direct **Identify this song** tap. Expo Go returns provider unavailable without requesting microphone permission because it does not include Mesta's local native module.
- `src/services/musicRecognitionService.ts` is the provider-neutral integration point. It is status-aware for unsupported platform, provider unavailable, no match, and matched metadata states, calls the optional local ShazamKit module only when linked in a native iOS build, and calls the optional local ACRCloud fingerprint module only when linked in a native Android build.
- `modules/mesta-shazamkit` is an Apple-only local Expo module. In native iOS builds, it runs one 12-second foreground `AVAudioEngine` capture attempt, feeds in-memory microphone buffers to `SHSession`, stops on match/no-match/timeout/cancel/background/interruption/route loss, and returns `matched`, `no_match`, or `provider_unavailable`.
- `modules/mesta-acrcloud` is an Android-only local Expo module boundary. In native Android builds, it runs one short foreground `AudioRecord` capture attempt, builds an in-memory ACRCloud fingerprint through the vendor SDK when bundled, stops on cancel/background/timeout, and returns only the base64 fingerprint to JS. It does not write raw audio files or put ACRCloud secrets in the app.
- `supabase/functions/recognize-android-music` authenticates before reading a bounded fingerprint request, enforces database/global limits, calls ACRCloud with a timeout, and publishes provider-returned metadata through a single-use service-role RPC. Deploy it with normal JWT verification.
- A successful Android match is already published when the function returns `published = true`; the client cannot resubmit or alter the match. A successful iOS match remains local and is shown only to the user who requested it.
- After a match, venue detail shows the suggested venue and song with Yes/No actions. Both answers are private `venue_music_reports.feedback_is_correct` records retained for up to 90 days and do not gate or reverse Android publication.
- Authorized admins can enter a reviewed title/artist through `set_admin_venue_now_playing()`. The server fixes source to `manual`, confidence to 1.0, and expiry to 45 minutes, writes history atomically, applies budgets, and stores a private 180-day audit action.
- Venue detail can show daily and monthly music history from public `venue_music_observations` rows.
- Raw audio is not written to files, uploaded to Mesta backend services, or stored in Supabase. Matching is foreground-only through ShazamKit in native iOS builds and ACRCloud fingerprints in native Android builds.

## Product Direction
- Keep iOS ShazamKit as local identification until an attested, server-verifiable publication path is reviewed. Expo Go will not contain the native ShazamKit module.
- Android uses ACRCloud as the selected provider path, but should return `provider_unavailable` until the Android native module is present, ACRCloud SDK binaries are bundled in the native build, and the Supabase Edge Function has ACRCloud env vars.
- Keep venue-authorized Spotify lower priority because major bars and clubs often do not use Spotify as the room playback source.
- Keep consumer Yes/No feedback private; only authorized admins get free-form manual song entry.
- Keep older high-confidence observations visible as venue sound history instead of labeling them as current now-playing.

## Provider Requirements
- Supports short foreground snippets only.
- Allows the app's nightlife venue use case under its terms.
- Returns track title and artist metadata without requiring raw audio retention.
- Provides clear handling requirements for EU users and processors/subprocessors.
- Can be called from a trusted backend or edge function when provider credentials are needed.

## Implementation Guardrails
- Do not enable background recording.
- Do not store raw audio in Supabase or device documents.
- Do not upload raw audio to Mesta backend services for the first ShazamKit path.
- Keep snippets in memory only and stop listening after one explicit foreground match attempt.
- Keep the in-app cancel path available while a native foreground check is running.
- Start real listening only from a venue-specific user action. The launch card tap first establishes a selected/confirmed venue context before venue detail starts matching.
- Store only matched track metadata, confidence, source, venue, and timestamps.
- Promote only trusted Android provider results or authorized admin updates into `venue_now_playing`, with short freshness windows.
- Store trusted provider/admin matches in `venue_music_observations`. Keep device Yes/No feedback and confirmations private in `venue_music_reports`.
- Keep user identity and report details private in `venue_music_reports`; public screens should expose only venue-level track metadata.

## Candidate Sources
- User Yes/No feedback: private accuracy input only; never public launch provenance and never an automatic correction.
- Venue Spotify: use only with explicit venue/account authorization.
- Audio recognition provider: iOS ShazamKit is validated for internal native builds; Android uses ACRCloud fingerprint recognition through the trusted Edge Function path once credentials and SDK binaries are configured.
- Manual admin: supported in venue detail for `app_admins` through `set_admin_venue_now_playing()`, with `npm run admin:set-now-playing` retained as emergency service-role tooling.

## Android ACRCloud Setup
- Create an ACRCloud Audio & Video Recognition project with the ACRCloud Music bucket and `Recorded Audio` source.
- Store the project `host`, `access_key`, and `access_secret` only as Supabase Edge Function secrets: `ACRCLOUD_IDENTIFY_HOST`, `ACRCLOUD_ACCESS_KEY`, and `ACRCLOUD_ACCESS_SECRET`.
- Deploy `supabase/functions/recognize-android-music` with JWT verification enabled so only app-authenticated calls can reach the provider proxy.
- Place the ACRCloud Android SDK jar and required `.so` files in `modules/mesta-acrcloud/android/libs/` for local Android validation, or set `RIENTO_FETCH_ACRCLOUD_ANDROID_SDK=1` in the EAS build environment so `scripts/fetchAcrCloudAndroidSdk.mjs` downloads the pinned public SDK binaries during remote builds. These binary files are ignored by git until licensing and redistribution are explicitly reviewed.
- Build a native Android EAS build; Expo Go cannot contain the local Android module or ACRCloud SDK binaries.
- Keep public now-playing publication behind the explicit Identify tap. Android matches publish directly inside the Edge Function through the service-role-only RPC; the app client has no `user_audio_match` publication permission.

## Next Technical Step
Retest local-only ShazamKit identification in the final TestFlight build. For Android, configure ACRCloud secrets, deploy the Edge Function, bundle the vendor SDK binaries, then produce an EAS Android preview build. Confirm one explicit Identify tap publishes provider-returned venue-level now-playing/history without a client-side second submission.

Verification for the first implementation:
- Build with an EAS iOS development or internal build, not Expo Go.
- Confirm one launch card appears per cold app process, can be dismissed, respects both Settings opt-outs, and does not appear again after tab navigation or background/foreground within that process.
- Start matching from **Check venue & song** or a venue-specific **Identify this song** tap.
- Confirm iOS performs no backend recognition-attempt claim or public publication.
- In Expo Go, confirm the provider-unavailable result appears without a microphone prompt.
- In an EAS iOS build with the local module linked, confirm microphone permission is requested only after the venue-specific tap. This passed in internal build `89c73d54-8781-4a56-a7fc-aa0066302f11`.
- Confirm a successful iOS match is displayed locally and creates no public row; Yes and No each create only a private feedback report and show the appreciation message.
- Confirm capture stops when the attempt finishes, the user taps cancel, or the app backgrounds.
- Confirm no raw audio files, Supabase Storage writes, or raw audio network requests are created.

Verification for Android ACRCloud:
- Confirm Expo Go returns provider unavailable before a microphone prompt.
- Confirm `npx expo-modules-autolinking resolve --platform android` finds `mesta-acrcloud` exactly once.
- Confirm the Android manifest includes `RECORD_AUDIO` only for builds where Android recognition is intentionally enabled, and still excludes background audio/storage permissions.
- On a physical Android build with ACRCloud SDK binaries and Edge Function secrets configured, confirm the microphone prompt appears only after the venue-specific tap.
- Confirm cancel/background/timeout stop capture and no raw audio files, Supabase Storage writes, or raw-audio logs are created.
- Confirm successful Android matches publish through `publish_provider_music_match()` from the original explicit Identify tap, with no client publication RPC and no second submit button.
- Confirm Android Yes/No feedback remains private and a No does not silently remove an already-published provider match.
- Confirm a forged direct `submit_venue_music_report(..., 'user_audio_match')` request is rejected.
- Confirm oversized requests, global/venue budget exhaustion, provider timeout, missing current venue signal, and replayed attempt IDs fail without public rows.

Verification for trusted admin entry:
- A normal or anonymous user cannot execute `set_admin_venue_now_playing()`.
- An allow-listed permanent admin can publish a reviewed title and optional artist from venue detail only after confirming the dialog.
- The public current row and history use source `manual`, confidence 1.0, server time, and a fixed 45-minute expiry; the client cannot choose these fields.
- Repeating the same entry inside two minutes is idempotent, and rate-limit exhaustion creates no public row.
