# App Privacy Disclosures Draft

Status: optional-review-account implementation source of truth for App Store privacy labels, Google Play Data safety, and final legal review.

## Store Submission Matrix

| Data type | Collected by Riento | Linked to pseudonymous session | Tracking | Third-party processing | Backend retention |
| --- | --- | --- | --- | --- | --- |
| Optional review-account email/relay email and authentication credential | Only when a user creates an account; pilot email accounts activate without inbox-ownership confirmation | Yes | No | Supabase Auth | Until in-app account deletion; Riento does not receive a reusable plaintext password |
| Google/Apple account provider and stable provider identifier | Only when the user chooses social sign-in | Yes | No | Google Identity Services, Apple Authentication Services, Supabase Auth | Until in-app account deletion; provider tokens/codes are not retained as Riento content |
| Basic Google profile name/photo metadata | May be returned with authentication scopes | Yes | No | Google Identity Services and Supabase Auth | Until account deletion; not used for a public Riento profile or unrelated Google APIs |
| Random Supabase user ID | On first server contribution | Yes | No | Supabase authentication infrastructure | Until in-app deletion or approved inactive-session cleanup |
| Deletion recovery capability hash and operation outcome | Only after explicit in-app deletion confirmation | Linked to the random user ID only while deletion is processing; target ID is cleared at completion | No | Supabase database / Edge Functions | Completed operation record up to 400 days; raw capability is stored only on the user's device |
| My spots and app preferences | Device only | No | No | No | Not stored by Riento backend |
| Foreground location | Used on device for Nearby and optional venue matching | A location-derived venue ID/confidence is linked and can reveal presence at a precise venue; raw coordinates are not stored by Riento | No | Platform location services and Supabase | Raw venue signals expire and are deleted after expiry |
| Manual venue placement | Optional | Yes | No | Supabase database | Expires and is deleted after expiry |
| 1–5 venue rating | Optional | Yes privately; no public identifier. Account-free ratings stay private; eligible permanent-account ratings contribute only after the minimum public sample | No | Supabase database | Stored until changed, deleted, moderated, or session deletion |
| Written venue review | Optional for permanent account holders | Yes privately; no public email/provider/profile | No | Supabase database | Pending until moderated; retained until edit, moderation, or account deletion |
| Written-review report/block | Optional and private | Yes | No | Supabase database | Resolved reports up to 90 days; blocks until removed or identity deletion |
| Venue reports | Optional and private | Yes | No | Supabase database | Kept for operator review; final resolved-report retention needs legal confirmation |
| Music report metadata | Optional | Yes privately | No | Supabase database | Private confirmation/report up to 90 days; trusted Android provider now-playing expires after about 45 minutes |
| Venue/song accuracy verdict | Optional after an explicit foreground match | Yes privately; the venue component can reveal precise presence | No | Supabase database | Yes/No feedback is retained privately for up to 90 days and does not automatically publish or correct music |
| Music observations/history | Derived venue-level metadata | No public identifier | No | Supabase database | Up to 35 days |
| iOS microphone audio | Explicit foreground tap only | No durable link | No | Apple ShazamKit system processing | In memory only; not stored or uploaded by Riento |
| Android audio fingerprint | Explicit foreground tap only | Request is authorized by pseudonymous session | No | ACRCloud | Transient provider request; no durable fingerprint storage |
| Diagnostics/security logs | Basic provider logs | Potentially | No | Supabase/Expo/platform infrastructure | Only as needed for operation and security |
| Map SDK request/device metadata and map interactions | Automatically processed when maps load or are used | Potentially, including IP address and Maps-specific pseudonymous identifiers | No | Google Maps Platform / react-native-maps | Controlled by provider terms; verify current platform disclosures before submission |
| Authentication fraud-prevention metadata | Automatically processed during Google/Apple sign-in | Potentially, including IP-derived general location and provider user identifier | No | Google Identity Services / Apple Authentication Services | Controlled by provider terms and account settings |

## Purpose
- App functionality: venue map, rankings, local My spots, account-free number ratings, optional email/Google/Apple account reviews, crowd signals, music signals, and private venue reports.
- Security and abuse prevention: pseudonymous authorization, cooldowns, rate limits, pre-publication review moderation, reporting, blocking, and private moderation records.
- Service improvement: venue-level crowd status, music history, and venue-data review.
- Data rights: direct in-app JSON export and deletion for the current private device session.

## Location
Riento requests foreground location only. Nearby sorting stays on the device and sends no crowd signal. One app-open accuracy-check offer appears per cold process session when enabled. Only after the user taps **Check venue & song** does Riento request foreground permission and, when near a known venue, send the matched venue ID and confidence before opening a one-shot music check. Users can dismiss or disable the offer.

Store forms must still evaluate the submitted venue ID as linked precise location because it can reveal presence at a specific bar or club. iOS and Android disclosures must be completed separately to account for platform SDK differences.

## Public Sharing
Public screens may show k=2 venue-level crowd labels, trusted now-playing metadata, music history, permanent-account rating summaries after a three-account minimum, and approved written reviews. They do not show individual locations, private session IDs, exact contributing-device counts, account-free ratings, account emails, provider identifiers/metadata, moderation notes, private reports, or local My spots/settings.

## Microphone
Music recognition starts only from **Check venue & song** or a venue-specific **Identify this song** tap. Riento does not listen in the background or store raw audio. Supported iOS builds use short in-memory ShazamKit processing and keep matches local unless the user sends private Yes/No feedback. Supported Android builds send a short fingerprint to ACRCloud through an authenticated, rate-limited Edge Function, which may publish provider-returned metadata directly after checking a current venue signal. Authorized admin manual entries are separately audited and treated as trusted venue-level metadata.

## Controls
- Turn the app-open foreground venue/song check offer off or back on in Settings.
- Disable manual placement and the post-placement music prompt.
- Clear local My spots and preferences.
- Export local data plus server contributions as JSON from the current installation.
- Delete server contributions, the pseudonymous session, and local data in-app.
- Delete an optional review account and its attributable data in-app.
- Revoke Google/Apple provider access during in-app deletion where available, with manual provider-removal guidance if revocation fails.

## Launch Checklist
- Keep verified Supabase Anonymous Sign-Ins/manual linking enabled and review Auth rate limits.
- Keep pilot email/password auto-confirm and the `mesta://profile` password-reset callback configured; finish Google web/iOS/Android client setup and native Apple capability/client/revocation-secret setup.
- Apply the generated SQL, deploy `delete-device-data` with gateway JWT verification disabled for capability recovery, and keep normal JWT verification on `recognize-android-music`.
- Confirm `sample_size` is not selectable by app roles.
- Confirm anonymous sessions cannot submit written text, account reviews start pending, only approved text is public, and one identity has at most one rating/review per venue.
- Confirm report/block actions work and the moderation queue has a named daily operator.
- Confirm crowd and music expiry/cleanup jobs are scheduled.
- Confirm privacy labels classify the random Supabase UUID as a pseudonymous User ID, not a hardware or advertising Device ID.
- Confirm no service-role key or private admin tool is bundled in the app.
- Confirm no Google/Apple token, authorization code, nonce, client secret, or Apple private key is logged, exported, or bundled.
- Confirm anonymous-to-provider linking preserves the UUID, collisions preserve the anonymous session, and Google/Apple deletion revocation is tested on physical devices.
