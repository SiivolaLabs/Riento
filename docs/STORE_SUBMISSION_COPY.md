# iOS App Store Submission Copy

Status: ready for account-free core flow and optional review-account device testing. Use only after the new binary, moderation operation, and production Supabase configuration pass verification.

## Promotional Text
Explore Helsinki bars and clubs with privacy-first venue signals, simple crowd labels, and a clean night-out map.

## Subtitle
Explore Helsinki nightlife

## Description
Riento helps you decide where to go tonight in Helsinki.

Explore bars and clubs on a clean dark map, compare venue rankings, check broad crowd labels such as Quiet, Active, Busy, and Packed, and view venue-level now-playing information when available.

Use Riento to:
- Browse Helsinki bars and clubs without creating an account.
- Sort nearby venues using foreground-only location.
- Save My spots and preferences locally on this device.
- Save account-free 1–5 feedback privately, or optionally use email, Google, or Apple for public rating summaries and moderated written venue reviews after minimum-sample checks.
- Use an optional one-tap foreground venue/song check and send private Yes/No accuracy feedback without registering.

Two recent private identities can publish community Active; Busy/Packed require an authorized temporary estimate. The cold-session venue/song offer does nothing until the user taps it, and microphone use is one-shot foreground-only. Trusted Android provider matches and authorized-admin manual entries may update venue-level now-playing, while iPhone matches and user Yes/No feedback remain private. Written reviews are held for moderation before publication and include in-app reporting and reviewer blocking. Riento never shows individual user locations, account emails, private app identifiers, or exact public crowd counts. Venue and live-signal information may be delayed, incomplete, or inaccurate.

## Keywords
Helsinki,nightlife,bars,clubs,map,crowd,venues,going out,music,leaderboard

## Notes Before Submission
- Upload a new binary containing the account-free core flow and optional email/Google/Apple review accounts; metadata-only resubmission is insufficient.
- Replace the complete Description in every App Store localization.
- Add a private pre-created email/password review demo account in App Review Information so review text and deletion can be tested without email delivery. Apple and Google buttons must also work for App Review. Do not place credentials in public metadata or this repository.
- Check Promotional Text, Subtitle, Keywords, What's New, screenshot captions, and App Review Information for Android or other cross-platform references.
- Confirm the privacy policy, support, terms, Community Guidelines, and deletion URLs describe account-free ratings plus optional moderated account reviews.
- Confirm a named operator is checking the written-review queue daily before enabling review text in production.

## Production URLs
- Homepage: `https://riento.expo.app/legal/index.html`
- Privacy Policy: `https://riento.expo.app/legal/PRIVACY_POLICY.html`
- Support: `https://riento.expo.app/legal/SUPPORT.html`
- Terms: `https://riento.expo.app/legal/TERMS.html`
- Data Deletion: `https://riento.expo.app/legal/ACCOUNT_DELETION.html`
- Community Guidelines: `https://riento.expo.app/legal/COMMUNITY_GUIDELINES.html`

## App Review Response

Hello App Review,

We addressed both issues in the new submission.

Guideline 5.1.1(v): Riento opens directly to the Map and does not require registration for browsing, Map, Top, venue details, on-device My spots/settings, 1–5 ratings, venue feedback, crowd contributions, or music confirmations. Optional email, Google, and Sign in with Apple accounts are offered only to users who want to add written venue reviews.

For account-free backend access control and abuse prevention, Riento creates a random pseudonymous Supabase session in the background only when a user first submits server data. This creates no public profile. Optional review accounts do not expose email addresses, provider identifiers, or profiles publicly and can be deleted directly in Settings with provider revocation where available. Review credentials are supplied privately in App Review Information.

Guideline 4.8: The iOS app offers native Sign in with Apple alongside Google. Both methods request only authentication scopes, support account deletion, and are not used for advertising tracking.

Guideline 1.2: New and edited written reviews are private until operator approval. Published reviews include in-app Report and Block reviewer actions. Community Guidelines and support contact information are available from the support/legal pages, and the moderation queue is reviewed daily.

Guideline 2.3.10: We removed references to other platforms from the iOS metadata and reviewed every localization so it describes only the submitted iOS experience.

Thank you.
