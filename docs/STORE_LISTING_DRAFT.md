# Store Listing Draft

Status: cross-platform working draft for product and legal review. Do not paste this mixed-platform document into App Store Connect.

The canonical iOS-only submission copy lives in `docs/STORE_SUBMISSION_COPY.md`.

Google Play implementation note:
- Public store/listing name is `Riento`.
- The shipped Android application id is `com.riento.app`.

## App Name
Riento

## Subtitle
Explore Helsinki nightlife.

## Short Description
Find Helsinki bars and clubs with live crowd and music signals.

## Full Description
Riento helps you explore where to go tonight in Helsinki.

Open the map to see bars and clubs, browse venue rankings, check broad crowd labels such as Quiet, Active, Busy, and Packed, and see what is playing when a venue-level now-playing signal is available. Riento is designed around venue-level signals, not public user tracking. Individual user locations and exact public crowd counts are not shown.

Core features:
- Map of Helsinki bars and clubs.
- Venue ranking with broad crowd labels.
- Venue-level now-playing status when fresh trusted data is available.
- Near me ranking with foreground-only location sorting.
- Optional manual placement when GPS is unavailable or inaccurate.
- Private venue feedback for wrong or missing venues.
- Account-free private rating feedback and public rating summaries only after a permanent-account minimum, plus optional pre-moderated written reviews from email, Google, or Apple account holders.
- One-tap foreground venue/song checks with private Yes/No accuracy feedback: local matching on iPhone and trusted server publication for supported Android matches.
- Settings controls for location sharing, direct data export/deletion, and optional review-account creation/deletion.

Venue data, opening hours, and crowd estimates should be treated as guidance, not guarantees.

## Keywords
Helsinki, nightlife, bars, clubs, map, leaderboard, crowd, going out, venues

## Screenshot Checklist
- Map with selected venue detail card.
- Leaderboard with broad crowd labels and trend labels.
- Venue detail page with now-playing and report actions.
- Settings privacy, optional account, and data controls.
- Near me leaderboard state.

## Review Notes
- Copy privacy/disclosure answers from `docs/APP_PRIVACY_DISCLOSURES_DRAFT.md` instead of rewriting them from memory during submission.
- Confirm final legal text before submission.
- Confirm Anonymous Sign-Ins/manual linking, pilot Email/password auto-confirm, Google, Apple, and `mesta://profile` are configured and physically tested.
- Confirm report/block actions, Community Guidelines, and daily moderation operation before enabling written reviews.
- Confirm ShazamKit/microphone behavior is validated on a physical iPhone before advertising the user-initiated venue/song check.
- Confirm ACRCloud/microphone behavior is validated on a physical Android device before advertising the user-initiated venue/song check.
- Confirm store screenshots do not show real user emails or sensitive test data.
- Confirm venue data claims match verified production coverage.
- Add iPad screenshots and layout checks while `supportsTablet` remains enabled.
