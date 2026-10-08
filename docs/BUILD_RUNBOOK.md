# Build Runbook

Status: required release procedure. Use with `docs/LAUNCH_OPERATIONS.md`.

Branding note:
- Public-facing brand name is `Riento`.
- Internal technical identifiers still remain `mesta` in most places, including `slug`, `scheme`, and the local `mesta-shazamkit` module naming.
- Android package id and iOS bundle id are now `com.riento.app` for store release prep.
- Keep Play Store/App Store listing text on `Riento` while leaving the remaining internal identifiers unchanged unless a separate migration is planned.

## Local Verification
Run the standard checks before any build:

```sh
npm run verify
npm run verify:launch:live
```

Optional Android bundle export smoke test:

```sh
npx expo export --platform android --output-dir /tmp/opencode/mesta-export-build-check
```

## EAS Setup
Install and authenticate EAS CLI from a trusted terminal:

```sh
npm install --global eas-cli
eas login
```

Link or create the Expo project when prompted:

```sh
eas build:configure
```

## Internal Test Builds
Android internal build:

```sh
eas build --platform android --profile preview
```

Android Play Store note:
- Android music recognition now uses the reviewed ACRCloud fingerprint path when a native build includes `modules/mesta-acrcloud`, the ACRCloud SDK binaries, and the deployed `recognize-android-music` Supabase Edge Function. Android microphone permission is expected for that supported build path, but background audio/storage permissions should remain absent.
- Android Map startup requires a Google Maps API key. `app.config.js` reads `GOOGLE_MAPS_API_KEY` or `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`, injects it into the native Android Google Maps config for EAS builds, and exposes only `extra.androidGoogleMapsConfigured` to JS for the Map fallback guard.
- The Android Maps key must be available in the EAS environment used by the build profile. Use `sensitive` or `plaintext` visibility, not `secret`, because Expo config must read it while generating native Android config. `production` builds use the EAS `production` environment; `preview` builds use the EAS `preview` environment.

iOS internal/TestFlight preparation requires Apple Developer account access:

```sh
eas build --platform ios --profile preview
```

## Native Music Recognition Builds
The chosen first audio matching path is iOS ShazamKit through the Apple-only local Expo module at `modules/mesta-shazamkit`. Expo Go cannot verify that module because it only includes Expo Go's bundled native code; the JS service returns provider unavailable there before requesting microphone permission.

Before testing ShazamKit:
- Keep `expo-audio` background recording disabled in `app.json`.
- Confirm Apple Developer provisioning/capabilities for ShazamKit and microphone usage. Apple currently issues `com.riento.app` Ad Hoc and App Store profiles without `com.apple.developer.shazamkit` even when the ShazamKit App Service is checked, so `app.config.js` does not request that signing entitlement by default. Set `RIENTO_ENABLE_SHAZAMKIT_ENTITLEMENT=1` only after Apple issues a provisioning profile that actually contains `com.apple.developer.shazamkit`.
- If Xcode reports that the provisioning profile does not include `com.apple.developer.shazamkit`, do not keep regenerating the same profile and do not replace the Apple Distribution certificate unless EAS says it is invalid. Inspect the downloaded `.mobileprovision`; if Apple still omits the entitlement for the right team/app, contact Apple Developer Support or keep the entitlement disabled to unblock non-Shazam iOS builds.
- Confirm `npx expo-modules-autolinking resolve --platform ios` finds `mesta-shazamkit` exactly once from `modules/mesta-shazamkit`.
- Use an EAS iOS development or internal build on a physical iPhone.
- Validate that `MestaShazamKitModule.swift` starts one foreground one-shot capture attempt, returns match/no-match/provider-unavailable, and stops capture on cancel, timeout, background, interruption, or route loss.
- Android uses the ACRCloud fingerprint path through `modules/mesta-acrcloud` plus `supabase/functions/recognize-android-music`. Expo Go should still return provider unavailable, and native Android builds return provider unavailable until the ACRCloud SDK jar/`.so` files are bundled and Edge Function secrets are configured.
- Confirm `npx expo-modules-autolinking resolve --platform android` finds `mesta-acrcloud` exactly once before building an Android recognition test.

## Production Builds
Production Android:

```sh
eas build --platform android --profile production
```

When EAS cloud-build quota is unavailable, build on the local Mac without consuming a cloud-build credit:

```sh
set -a
source .env
set +a
NODE_ENV=production \
ANDROID_HOME="/opt/homebrew/share/android-commandlinetools" \
ANDROID_SDK_ROOT="/opt/homebrew/share/android-commandlinetools" \
ANDROID_NDK_HOME="/opt/homebrew/share/android-commandlinetools/ndk/27.1.12297006" \
JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home" \
PATH="/opt/homebrew/opt/openjdk@17/bin:/opt/homebrew/share/android-commandlinetools/platform-tools:$PATH" \
RIENTO_FETCH_ACRCLOUD_ANDROID_SDK=1 \
EAS_BUILD_NO_EXPO_GO_WARNING=true \
npx eas-cli build --platform android --profile production --local --clear-cache --non-interactive --output "./riento-play.aab"
```

Local EAS mode still retrieves the existing remote Android keystore, which is required because Google Play expects upload certificate SHA1 `A8:AA:6C:AB:28:3E:B6:00:89:D4:75:51:08:59:AF:08:B4:57:4A:88`. Verify the resulting AAB certificate before upload.

Do not share the opaque `eas-cli-local-build-plugin` argument printed at the end of failed local-build logs; it contains encoded Android signing credentials. Share only the preceding Gradle error lines when troubleshooting.

Preferred Play Store artifact:
- Upload the Android App Bundle (`.aab`) generated by the EAS production build to Play Console.
- Treat the first Android production build after enabling ACRCloud as a manifest-verification checkpoint. `RECORD_AUDIO` is expected only for the foreground recognition path; confirm the uploaded artifact does not declare foreground-service, background audio, storage, overlay, wake-lock, boot, or audio-modification permissions unexpectedly.

Production iOS:

```sh
eas build --platform ios --profile production
```

When EAS cloud-build quota is unavailable, build locally with full Xcode, CocoaPods, and Fastlane installed:

```sh
DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer" \
NODE_ENV=production \
EAS_BUILD_NO_EXPO_GO_WARNING=true \
env -u RIENTO_ENABLE_SHAZAMKIT_ENTITLEMENT \
npx eas-cli build --platform ios --profile production --local --clear-cache --non-interactive --output "./riento-ios-production-latest.ipa"
```

Local iOS notes:
- `plugins/withIosGoogleSignInPods.js` gives `GoogleUtilities` and `RecaptchaInterop` modular headers so Google Sign-In's Swift `AppCheckCore` pod can be integrated as a static library.
- `npm` `postinstall` patches `@react-native-google-signin/google-signin@16.1.2` to expose GoogleSignIn 9's iOS nonce parameter. Keep that dependency pinned and remove the patch when upstream nonce support ships.
- The signing certificate is issued by Apple WWDR G3. If local EAS cannot import an otherwise active distribution certificate, install `AppleWWDRCAG3.cer` from Apple's official PKI page in the login keychain.
- If Xcode says the App Store profile omits `com.apple.developer.applesignin`, run `eas credentials:configure-build --platform ios --profile production`, let EAS sync Sign in with Apple, decline reuse of the invalid profile, and generate a new one. Do not disable Apple sign-in to preserve an outdated profile.

If a non-interactive production iOS build fails with `Credentials are not set up. Run this command again in interactive mode.`, run the same command without `--non-interactive` once from a trusted terminal and let EAS set up or validate the App Store credentials for `com.riento.app` under Apple team `JA8353PW53`. Keep `RIENTO_ENABLE_SHAZAMKIT_ENTITLEMENT` unset unless Apple starts issuing a provisioning profile that contains `com.apple.developer.shazamkit`.

## Pre-Build Checklist
- If `COPY_AND_PASTE.md` contains a current SQL, dashboard, build-tracking, or store-console action, complete it against the production Supabase/store project before release.
- Confirm Anonymous Sign-Ins/manual linking, pilot Email/password auto-confirm, Google, Apple, and `mesta://profile` are configured per `docs/AUTH_OAUTH_RUNBOOK.md`.
- Confirm EAS production iOS credentials have been set up/validated. Production build `f71f14c8-259d-42ac-90f6-095b32fde2af` started non-interactively with remote App Store credentials ready.
- Confirm Google has Web, iOS, EAS-upload Android, and Play-signing Android OAuth clients for `com.riento.app`; confirm the Riento consent screen and legal URLs are production-ready.
- Confirm `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` are set in the matching EAS environment. `app.config.js` derives the required reversed iOS URL scheme and omits the Google plugin when the iOS ID is absent.
- Confirm Apple App ID `com.riento.app` and the generated provisioning profile include Sign in with Apple, Supabase accepts native audience `com.riento.app`, and the four Apple revocation secrets from `COPY_AND_PASTE.md` are set.
- Confirm `.env` points to the intended backend before building.
- Confirm `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are set in the EAS build environment; otherwise live contributions, review accounts, export, and deletion are unavailable.
- Confirm `EXPO_PUBLIC_LEGAL_BASE_URL` is `https://riento.expo.app/legal` in EAS preview/production. The app uses that same production URL as a compile-time fallback. Verify every Settings link in the built app.
- Confirm `GOOGLE_MAPS_API_KEY` or `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` is set in the EAS build environment before Android production builds.
- Confirm the Maps key is not stored with EAS `secret` visibility if it is needed by `app.config.js`; use `sensitive` or `plaintext` instead.
- For Android music recognition builds, confirm the `recognize-android-music` Supabase Edge Function is deployed with JWT verification and has `ACRCLOUD_IDENTIFY_HOST`, `ACRCLOUD_ACCESS_KEY`, and `ACRCLOUD_ACCESS_SECRET` configured as Supabase secrets. Do not put ACRCloud provider secrets in Expo public env or EAS mobile build env.
- For Android music recognition builds, confirm the ACRCloud Android SDK jar and required `.so` files are available to the native build under `modules/mesta-acrcloud/android/libs/`. For EAS remote builds, set `RIENTO_FETCH_ACRCLOUD_ANDROID_SDK=1` so the pre-install hook downloads the pinned public SDK binaries. These files are git-ignored until licensing/redistribution is reviewed.
- If a signed Android build passes the in-app missing-key guard but still shows a white/blank Google map, check Google Cloud before changing app code again: Maps SDK for Android enabled, billing active, and API key Android app restrictions matching package `com.riento.app` plus the SHA-1 signing certificate for the installed artifact. Use the Play App Signing SHA-1 for Play-installed builds, or the EAS Android build credential SHA-1 for directly sideloaded EAS artifacts.
- Confirm `SUPABASE_SERVICE_ROLE_KEY`, Google client secret, Apple private key, provider tokens, and authorization codes are not present in Expo public env vars, EAS build env, `app.json`, logs, exports, or mobile source files.
- Confirm the Android build requests microphone permission only when Android recognition is intentionally supported and the Play Data safety/privacy disclosures have been updated.
- Copy App Store privacy-label and Google Play Data safety answers from `docs/APP_PRIVACY_DISCLOSURES_DRAFT.md`; do not re-interpret location/audio/export/deletion behavior during submission.
- Confirm the privacy policy, terms, Community Guidelines, review moderation runbook, support, deletion page, and store disclosure text are approved and hosted.
- Confirm a named operator is checking pending/reported written reviews daily and has successfully dry-run and confirmed `admin:moderate-review`.
- Confirm every required owner in `docs/LAUNCH_OPERATIONS.md` has a named primary and backup in the private operator record.
- Confirm managed backup/PITR and an isolated restore drill, then run `npm run ops:queues` with no SLA breach or stuck deletion.
- Confirm the release source is clean, committed, tagged, pushed to a protected remote, and the new artifacts are traceable to that tag.
- Confirm venue data and screenshots do not include sensitive test data.
- Test the iPad layout and prepare required iPad screenshots because `supportsTablet` is enabled, or disable tablet support before submission.

## First Android Release Verification
After the first Android production `.aab` is built:
- Local Android manifest inspection previously showed Google Maps Android meta-data present and marked audio/storage overlay permissions for removal while Android recognition was unsupported. After enabling Android ACRCloud recognition and tightening the final Android blocked-permission list, `RECORD_AUDIO` is expected, while foreground-service/media-playback, `MODIFY_AUDIO_SETTINGS`, storage, overlay, wake-lock, and boot permissions should remain absent/removed from app-level `uses-permission` entries. Current production artifact `riento-play-production-area-search.aab` (version code 22, SHA-256 `04a62187a4e95aa4b6410c2fd9dfe6e14a978051a6ae7b056a73e91a35652a30`) passes this manifest check, Bundletool/ZIP validation, expected signing-certificate verification, non-debuggable universal-APK inspection, and 16 KB ZIP plus 64-bit ELF load-segment alignment checks.
- Install or upload the build and confirm a fresh install opens directly to Map without registration and offers **Check venue & song** once per cold process. Verify dismiss, location allow/deny, a venue signal only after the explicit tap and a supported venue within 120 m, one-shot microphone permission only after that tap, the venue/song Yes/No screen and appreciation message, both Settings opt-outs, account-free ratings/crowd/music, authorized-admin trusted song entry, immediate pilot email activation/password reset, Google/Apple sign-in/linking/collision/sign-out/export/deletion, pending text moderation, report/block, and anonymous deletion. Pan/zoom and confirm **Search this area** commits markers immediately, high-activity venues dominate capped marker sets without eliminating geographic coverage, selected venues remain stable through live updates, tapping empty map space closes the selected venue card without breaking marker taps, iOS Apple Maps is muted without POI/building/traffic/compass clutter, and Android retains its dark Google map and compass behavior.
- Confirm the Map tab renders real map tiles, not only a white/blank Google map. If tiles are white/blank while the app no longer shows the missing-key warning, treat Google Cloud API-key package/SHA authorization as the primary suspect.
- Check the generated Android permissions in Play Console or the final Android manifest before rollout.
- Confirm location permissions are expected for the current product behavior.
- Confirm cold/slow/offline launches show provisional venue browsing immediately, preserve selected venues during the live slug-to-UUID replacement, refresh stale venue data once after foregrounding, and keep long Top rankings responsive under fast scrolling and filter changes.
- Confirm `RECORD_AUDIO` appears only for the intentional foreground Android recognition build path, with no foreground-service, background audio, storage, overlay, wake-lock, boot, or audio-modification permissions.
- If unexpected microphone/foreground-service/background/storage permissions appear, stop and fix the Android config before submitting to production.

## Play Store Submission Checklist
- Confirm the Play Console app uses package name `com.riento.app`.
- Upload the production `.aab` from EAS.
- Review the permissions surfaced by Play Console after upload and confirm they match the intended Android experience.
- Fill in Google Play Data safety answers from `docs/APP_PRIVACY_DISCLOSURES_DRAFT.md`.
- Complete App access with the private pre-created review demo account, Target audience, Content rating/UGC, Ads declaration, and the Data deletion URL/questionnaire.
- Confirm Terms and Community Guidelines acceptance is required before the first written-review submission.
- Disclose optional email/password, Google, and Apple account creation plus in-app deletion. Select the applicable OAuth/social-login and linked account-identifier/contact-info disclosures without classifying authentication as advertising tracking.
- Use Android-specific listing text that describes foreground music recognition only after the ACRCloud path has passed physical-device validation.
- Upload screenshots that reflect the current Android experience.
- Confirm the published `docs/PRIVACY_POLICY.md` text is live at the production privacy-policy URL before rolling out to production.
