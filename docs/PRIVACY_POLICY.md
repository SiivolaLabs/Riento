# Riento Privacy Policy

Effective date: `2026-08-01`

Operator: `Pieti Siivola`

Contact: `Siivola.Labs@proton.me`

This Privacy Policy explains how Riento handles information in the Riento mobile app.

Riento helps people find active Helsinki bars and clubs. Browsing and all venue-signal features work without an account. Users may optionally use email/password, Google, or Apple only to add written venue reviews.

## Private App Session And Optional Account
Browsing venues, using Nearby, saving My spots, and changing preferences do not create a backend identity.

When you first submit server data, Riento creates a random pseudonymous Supabase session in the background. This session lets the backend authorize contributions, apply cooldowns, provide your data controls, and reduce abuse. The random identifier is not a hardware identifier or advertising ID and is never shown publicly.

If you choose to create a review account, Supabase processes the selected authentication method. During the controlled pilot, email accounts activate without an inbox-ownership confirmation message; users should provide an address they control because password recovery is sent there. Google or Apple accounts use a provider identifier, provider name, and email or Apple relay email; Google may also supply basic profile name/photo metadata to Supabase. Riento does not use provider data for advertising, unrelated Google APIs, or a public profile. Account information is not displayed publicly, and the account can be deleted directly in Settings together with its attributable data.

When a private app session already exists, a new Google or Apple identity is linked to that same Supabase user ID so existing contributions remain attached. If the provider already belongs to another Riento account, Riento does not silently replace or merge the private session.

## Information We Handle
Riento may handle:
- A random private Supabase user ID after the first server contribution
- Optional account email or relay email, authentication provider, provider account identifier, and basic provider profile metadata
- Venue-level GPS-derived signals when foreground sharing is enabled
- Manual venue placements
- Number-only 1–5 venue ratings
- Optional written venue reviews from permanent account holders
- Private written-review reports and reviewer blocks
- Private venue and missing-venue reports
- Track title, artist, source, Yes/No accuracy feedback, and related metadata from music confirmations or matches
- Basic operational logs needed for security, debugging, and service operation

My spots, foreground-sharing preference, manual-placement preference, and music-prompt preference are stored locally on the device and are not synced to Riento.

## Location
Riento requests foreground location only and does not use background location tracking.

Location can be used to:
- Sort nearby venues on the device without submitting a crowd signal
- Match the device to a known venue after the user accepts the app-open accuracy check

The app-open accuracy-check offer starts enabled on new installs and appears once per cold app session. Riento requests foreground location only after the user taps **Check venue & song**. If permission is granted and the device is near a known venue, Riento submits the matched venue ID and a confidence value before opening the one-shot music check. Users can dismiss the offer or turn it off in Settings. Riento does not durably store the raw device coordinates used for matching and does not display individual locations.

## Crowd Signals
One device contribution remains private. A broad community Active label requires at least two recent private identities. Community contributions cannot produce Busy or Packed during launch; those levels require a time-limited authorized operator estimate. Crowd labels remain estimates and may be inaccurate. Public clients cannot read exact contributing-device counts, and public snapshot times are grouped into 15-minute buckets.

Raw venue pings and manual placements expire and are deleted after expiry. Crowd snapshots are kept for up to 7 days for recent trends, reconciliation, and abuse review.

## Ratings, Written Reviews, And Reports
Riento accepts account-free number-only 1–5 ratings as private feedback. The private session ID is used to keep one rating per installation and apply cooldowns, but no identifier appears publicly. Public rating summaries use at least three ratings from permanent accounts; pending or rejected written text does not contribute until approved or removed.

Written reviews require an optional permanent account. New or edited text is not public until an operator approves it. Approved review text appears without an email address, provider identifier, or public profile. Users can privately report written reviews and block a review author; blocks affect only the signed-in account or current private device session. Riento may reject or hide abusive, harassing, fraudulent, off-topic, or spam content. Resolved review reports are deleted after up to 90 days.

Venue reports and missing-venue reports are private operator-review inputs. They may contain text supplied by the user and are not shown publicly.

## Music Recognition And Audio
Riento does not store raw audio or listen in the background.

Music recognition begins only after a venue-specific user tap, including **Check venue & song** or **Identify this song**. Supported iOS builds use a short in-memory sample with Apple's ShazamKit; the match stays on that device unless the user submits private Yes/No accuracy feedback. Supported Android builds create a short in-memory fingerprint and send it through Riento's authenticated function to ACRCloud. The trusted function, not the client, may publish returned provider metadata after validating a current venue signal. The Android fingerprint is processed transiently and is not stored by Riento.

A trusted Android provider match or an authorized admin's manually verified entry can update venue-level now-playing. After matching, Riento shows the suggested venue and song and lets the user answer whether both are right. Yes/No answers and displayed-track confirmations are private feedback; they do not create, replace, remove, or extend public now-playing/history. Public now-playing expires after about 45 minutes. Venue music observations are retained for up to 35 days, private music feedback/report records for up to 90 days, and private admin music audit actions for up to 180 days.

## Public And Private Information
Riento may show publicly:
- Venue names, addresses, areas, categories, and broad crowd labels
- Venue-level now-playing and recent music history
- Rating summaries based on a minimum sample of permanent accounts
- Approved written venue reviews without account email or public profile details

Riento does not publicly show:
- Individual user locations or exact crowd counts
- Private session identifiers
- Account email addresses, provider identifiers, provider metadata, moderation notes, or public user profiles
- Private venue reports or manual-placement records
- Local My spots or preferences
- Raw audio or Android fingerprints

## Service Providers
Riento does not sell personal data or use the private identifier for advertising tracking.

Riento uses limited service providers as needed to operate the app:
- Supabase for public data, pseudonymous authentication, database, and Edge Functions
- Expo and platform infrastructure for building and operating the app
- Google Maps Platform for map display
- Google Identity Services for optional Google authentication
- Apple Authentication Services for optional Apple authentication
- Apple system services for supported ShazamKit matching
- ACRCloud for supported Android foreground fingerprint matching

## Data Controls
Settings provides controls to:
- Export the current installation's local data and server contributions as JSON
- Clear local My spots and preferences
- Delete contributions linked to the current private session, delete that session, and clear local data
- Delete an optional review account and its attributable data directly in the app

For Apple accounts, in-app deletion obtains a fresh, short-lived authorization code before executing deletion. Riento deletes attributable data, attempts bounded Apple revocation, and then removes the Auth identity. The native app attempts bounded Google revocation after Riento deletion is terminal. Provider tokens and authorization codes are not stored as Riento content. If provider revocation is unavailable, Riento deletion remains complete and the app tells the user how to remove provider access manually.

To make deletion recoverable if the network response or Auth session disappears, the device creates a random deletion capability. Riento stores only its one-way hash and operation outcome in a private service ledger. The random user ID and Apple subject are cleared from that record when deletion completes; completed capability records are retained for up to 400 days so the same device can confirm a lost response. The raw capability remains only on the device until local cleanup finishes.

Deleting app storage or losing the private session before using in-app deletion may prevent Riento from linking old pseudonymous records back to the installation. Expiry and cleanup schedules still apply. Contact `Siivola.Labs@proton.me` for help with a privacy request.

## Legal Bases
Depending on context, processing may rely on:
- Performance of the requested app function
- Legitimate interests in operating, securing, preventing abuse, and improving Riento
- Consent where required, including foreground location and microphone access
- Legal obligations, including data-subject rights handling

## Security
Riento uses reasonable technical and organizational measures, including row-level access controls and private server credentials. No system can guarantee absolute security.

## Children's Privacy
Riento is not intended for children. Users should only use Riento for nightlife decisions if they are legally allowed to enter relevant venues and use age-restricted services in their location.

## International Processing
Service providers may process data in multiple jurisdictions depending on infrastructure and platform services.

## Changes
Riento may update this policy. Material changes will be published with a revised effective date.

## Contact
`Pieti Siivola`

`Siivola.Labs@proton.me`
