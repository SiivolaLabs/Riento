# Device Session And Optional Account Runbook

Status: Google and native iOS Apple account support is implemented. Google Web/iOS build IDs are configured; physical-device provider verification remains required.

## Model
- Browsing, My spots, preferences, number-only ratings, crowd signals, music signals, and venue reports do not require visible account registration.
- The first server contribution calls `signInAnonymously()` through `ensureDeviceSession()` and persists the random session in SecureStore.
- Users may optionally use email/password, Google, or native iOS Apple to add written reviews.
- A new social identity links to the current anonymous Supabase UUID through `linkIdentity()` with a native ID token. Existing ratings and contributions remain owned by the same UUID.
- If Google or Apple already belongs to another Supabase user, linking fails. Riento does not replace or merge the anonymous identity; the user must explicitly delete that private session before signing in to the existing account.
- Written review text is accepted only when `is_anonymous=false` and starts in the private moderation queue.
- Venue/song Yes/No feedback is linked to the current private session but remains private. Free-form trusted song publication requires a non-anonymous account in `app_admins` and is reauthorized inside the database RPC.
- Pilot email accounts activate immediately without an inbox confirmation message. Password-reset callbacks use `mesta://profile`; native provider ID-token flows do not use that callback.

## Live Supabase State
Verified through the Management API on 2026-07-23:
- Anonymous Sign-Ins enabled
- Manual identity linking enabled
- Email/password enabled with `mailer_autoconfirm=true` for the controlled pilot
- `mesta://profile` included in the redirect allow-list
- Google and Apple enabled
- Apple native audience `com.riento.app` included

A disposable anonymous identity was created and deleted through the deployed authenticated function after the repair.

## Provider Setup

Configured for EAS development, preview, and production:
- Google Web client `370111862695-v9rmknhfrmanaqrff10qg292piik7ndq.apps.googleusercontent.com`
- Google iOS client `370111862695-v6jmmkfhc1vqgjh5i1mihrm4r491dm7i.apps.googleusercontent.com` for `com.riento.app`
- Hosted legal base `https://riento.expo.app/legal`

Google additionally requires verification that:
- Separate Google Cloud projects/credentials for preview testing and production
- A Web OAuth client used as the ID-token audience
- Android clients for package `com.riento.app` and each EAS/Play signing SHA-1
- Riento consent-screen branding, hosted legal URLs, and only OpenID/email/profile scopes
- Supabase Google `Skip nonce checks` remains disabled. The iOS app sends a SHA-256 nonce to Google and the raw nonce to Supabase; `postinstall` exposes GoogleSignIn 9's nonce-aware iOS API until the React Native wrapper ships it.

Apple requires:
- Sign in with Apple enabled on App ID `com.riento.app`
- EAS provisioning profiles containing the Apple Sign In entitlement
- Native client ID `com.riento.app` in Supabase
- `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and `APPLE_PRIVATE_KEY` Supabase Edge secrets for account-deletion revocation

No provider secret or Apple private key may be included in Expo/EAS public variables or the mobile bundle.

## App Behavior
- Google is offered on Android and iOS native Riento builds.
- Google iOS credentials use a per-request nonce. Android keeps the SDK's nonce-less native flow.
- Apple is offered only on iOS.
- Expo Go shows a useful native-build requirement rather than attempting Google or Apple account creation under Expo Go's identity.
- Provider buttons are hidden once an email upgrade is pending or a permanent account is active.
- Provider names, but no provider tokens, are included in the in-app JSON export.
- Password controls appear only for accounts with an email identity.
- Sign-out clears the local Supabase session and the Google SDK's local account state without revoking access.

## Deletion
- Google deletion verifies the cached Google subject, deletes Riento first, then makes a bounded `revokeAccess()` attempt. Failure produces manual Google Account removal guidance without changing Riento deletion success.
- Apple deletion obtains a fresh authorization code after explicit user confirmation. The Edge Function deletes attributable Riento data, exchanges the code, verifies the signed Apple token's issuer/audience/expiry/nonce/subject, makes a bounded `/auth/revoke` attempt, and then removes the Auth identity. Provider failure produces manual follow-up without preventing terminal Riento deletion.
- Apple signing credentials remain server-side. Provider tokens and authorization codes are not logged or stored.
- A provider outage must not leave Riento data undeleted after the server has accepted the deletion request; failed provider revocation is returned as a manual follow-up.

## Verification
1. Fresh install opens Map without registration and offers the app-open venue/song check; location and venue submission begin only after the explicit tap, permission grant, and a supported venue within 120 m.
2. Saving My spots and changing settings create no Auth user.
3. First account-free contribution creates exactly one anonymous Auth user; restart restores it.
4. Anonymous users can submit a number rating but direct text is rejected by the RPC.
5. Email upgrade preserves the exact UUID, activates without sending a confirmation message, and can set/reset a password through `mesta://profile`.
6. New Google and Apple accounts produce `is_anonymous=false` without first requiring a contribution.
7. Google and Apple linking from an anonymous session preserve the exact UUID and prior contributions.
8. Linking an already-owned provider fails without changing the anonymous session; explicit anonymous deletion then permits existing-account sign-in.
9. Cancelling, offline errors, missing provider configuration, and app restart do not replace the current identity.
10. Written review text starts pending and is absent from public reads before approval.
11. Export lists provider names but no credentials, tokens, nonces, or authorization codes.
12. Anonymous, email, Google, and Apple deletion remove the Auth identity and attributable rows; Google/Apple revocation behavior is verified in provider consoles.
13. Normal and anonymous users cannot publish manual now-playing; an allow-listed permanent admin can, and removing the allow-list row revokes access immediately.

## Abuse Controls
- Crowd writes are serialized, idempotent for immediate retries, limited to one active venue, and have a two-minute renewal cooldown.
- Ratings are unique per identity/venue and have a ten-minute update cooldown.
- Written reviews require a permanent account, are pre-moderated, and support private reports and author blocking.
- Pilot email ownership is not verified. Do not treat the stored email as proof of identity; rely on Auth/CAPTCHA limits, contribution budgets, pre-publication moderation, reports, and bans, and monitor account creation for abuse.
- Music publication is idempotent for retries and has a one-minute cooldown.
- Venue-specific recognition requires a verified private session and is limited to three attempts per hour.
- Monitor anonymous, email, Google, and Apple account creation for abuse.
