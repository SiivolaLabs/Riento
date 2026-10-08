# Launch Operations

Status: required for every external test and production rollout.

## Named Owners

Do not start external distribution until every role below has a named primary and backup in the private operator record:

| Role | Primary | Backup |
| --- | --- | --- |
| Incident commander | REQUIRED | REQUIRED |
| Supabase/backend operator | REQUIRED | REQUIRED |
| Review and report moderator | REQUIRED | REQUIRED |
| Store release operator | REQUIRED | REQUIRED |
| User support and privacy requests | REQUIRED | REQUIRED |

Never put personal phone numbers, credentials, service-role keys, or private escalation details in this repository.

## Launch Gates

All gates are pass/fail:

1. The release source is committed, tagged, pushed to a protected private remote, and the worktree is clean.
2. New AAB/IPA artifacts are built from that tag after the launch-hardening schema and client changes.
3. Artifact hashes, versions, source tag, build commands, signing fingerprints, and verification results are recorded in the private release record.
4. `npm ci`, `npm run verify`, and `npm run audit:venues:osm` pass.
5. The canonical schema, seed, Edge Functions, and four cron jobs are deployed; `npm run verify:launch:live` passes.
6. Supabase managed backups or PITR are enabled and an isolated restore drill has passed.
7. Play internal testing and TestFlight installs pass the physical-device matrix in `docs/BUILD_RUNBOOK.md`.
8. Store privacy, UGC, account, deletion, permission, age-rating, and review-access forms match the release.
9. Primary and backup operators have tested access and `npm run ops:queues` reports no SLA breach or stuck deletion.
10. Maps, Supabase, Auth, Edge Function, ACRCloud, moderation, and store-health dashboards have alert recipients.
11. Staging passes `npm run loadtest:reads -- --concurrency 100`, then 500 and 1000, with zero failures and p95 below 3 seconds. A staging-only hotspot test confirms 1,000 simultaneous signal attempts remain bounded and cron reconciliation completes within the next cycle.

## Monitoring

Check during every rollout stage and at least twice daily during the launch week:

- `npm run verify:launch:live`
- `npm run ops:queues` from a trusted operator machine
- Supabase API/Auth/database/Edge errors, latency, CPU, connections, disk, and anonymous-user creation
- `cron.job_run_details` for crowd, dynamic cleanup, moderation cleanup, and rate-bucket cleanup
- ACRCloud requests, error rate, no-match rate, and spend ceiling
- Google Maps quota, authorization failures, and billing alerts
- App Store Connect crashes/hangs and Play Android vitals
- Support inbox and moderation handoff log

Stop rollout when any of these occurs:

- Any privacy, authorization, deletion, or account-linking defect
- Two consecutive live verification failures
- Legal-page mismatch or crowd snapshot age above 20 minutes
- A deletion operation remains `processing` for more than 15 minutes
- Any urgent moderation report exceeds 24 hours
- Crash-free sessions fall below 99.5% or materially regress from the previous stage
- Database CPU, connection, disk, or provider budget exceeds 85% for 15 minutes
- Anonymous identities, contribution volume, or provider calls show an unexplained spike

## Incident Levels

- SEV-0: personal-data exposure, credential compromise, cross-user access, or deletion failure at scale. Stop rollout and affected writes immediately; preserve logs; contact vendors and legal/privacy support.
- SEV-1: startup/backend/Auth outage, widespread false public data, or severe crash regression. Pause rollout, use kill switches, and communicate service status.
- SEV-2: degraded enrichment, one provider, or one venue. Contain the feature and continue only if privacy, deletion, and core browsing remain healthy.

The incident commander records start time, scope, decisions, actions, evidence locations, user/vendor communications, recovery verification, and follow-up owner. Never place tokens, emails, fingerprints, review text, or user IDs in incident chat or public status messages.

## Kill Switches

Launch controls are enforced in database writes. Run only in a trusted Supabase SQL Editor session:

```sql
update public.launch_runtime_controls
set crowd_writes_enabled = false,
    ratings_enabled = false,
    written_reviews_enabled = false,
    venue_reports_enabled = false,
    music_sharing_enabled = false,
    audio_recognition_enabled = false,
    maintenance_message = 'Contributions are temporarily paused while Riento remains available for browsing.',
    updated_at = now()
where singleton = true;
```

Enable only the reviewed feature columns after the incident is contained. Keep browsing, public legal pages, data export, and `delete-device-data` available. Run `npm run verify:launch:live` after restoration; it intentionally fails while any launch feature is disabled so rollout cannot resume accidentally.

For provider cost abuse, disable `audio_recognition_enabled` first and enforce the ACRCloud quota. For false music, also disable `music_sharing_enabled` and remove the affected current/history rows through a reviewed admin action. For false crowd data, disable `crowd_writes_enabled`; the reconciliation cron will continue expiring old state.

## Backups And Restore

Primary protection must be Supabase managed backup/PITR. Launch targets:

- RPO: 24 hours maximum
- RTO: 4 hours
- Managed backup or PITR: enabled before external testing
- Encrypted logical archive: weekly with `npm run ops:backup`
- Restore drill: before launch and quarterly, into a separate isolated Supabase project

Never restore directly over production as the first test. Restore to an isolated project, deploy matching Edge Functions and cron jobs, supply secrets from the password manager, run the live verifier against that project, test Auth UUID relationships/RLS/export/deletion/moderation, and destroy the drill environment after recording non-sensitive evidence.

## Moderation And Support

- Check pending written reviews and reports at least twice daily during launch.
- Provide Friday/Saturday Helsinki coverage from 18:00 to 04:00 EEST.
- Decide urgent threat, harassment, or personal-information reports within 24 hours.
- Decide other reports within 72 hours and pending written reviews within 24 hours.
- Record operator, record ID, policy basis, action, and time in the restricted moderation log.
- Keep privacy/deletion requests separate from content moderation and follow their dedicated runbooks.

If primary and backup moderation coverage is unavailable, set `written_reviews_enabled = false` before continuing rollout.

## Staged Rollout

Android:

1. Play internal testing and full smoke matrix.
2. Closed test for at least 48 hours.
3. Production 5% for 24 hours.
4. Production 20% for 24 hours.
5. Production 50% for 24 hours.
6. Production 100% only after all gates remain green.

iOS:

1. TestFlight internal and full smoke matrix.
2. Controlled external TestFlight group for at least 48 hours.
3. App Store phased release with checks at each phase.

Store pause controls do not remove installed binaries. Use server kill switches for immediate containment. Android rollback requires a new higher version code; retain the previous source, artifacts, and release record.

## Physical Smoke Matrix

Test store-installed builds, not only local builds:

- Fresh Map launch, real tiles, search/refresh area, zoom thresholds, repeated venue selection, filters, Directions, offline/slow-backend fallback
- Cold-process launch offer once per session, dismiss/retry, location permission allow/deny, both Settings opt-outs, no prompt-triggered background listening, malformed-settings fail-closed behavior, and k=2 crowd publication
- Anonymous private number rating, permanent-account public-rating threshold, written-review pending/approve/reject/report/block
- Immediate pilot email activation/password reset, Google/Apple new/link/collision/sign-out/revocation/export/deletion, and deletion recovery
- Android trusted ACRCloud publication, iOS local-only ShazamKit result, venue/song Yes/No feedback plus appreciation state, private track confirmation, authorized-admin manual song publication, cancel/background/timeout, and no raw-audio storage
- Runtime kill switches for every contribution type while browsing/export/deletion remain available

Record pass/fail, platform/build, device/OS, operator, and time in the private release record.

## Load Test

Use a production-equivalent staging project first:

```sh
export EXPO_PUBLIC_SUPABASE_URL="https://STAGING_PROJECT.supabase.co"
export EXPO_PUBLIC_SUPABASE_ANON_KEY="STAGING_ANON_KEY"
npm run loadtest:reads -- --concurrency 100
npm run loadtest:reads -- --concurrency 500
npm run loadtest:reads -- --concurrency 1000
```

The script reproduces the exact cold client path: one full venue-row GET followed by one direct protected enrichment-cache GET. It fails on any HTTP/network error or p95 above 3 seconds. Do not run write or anonymous-signup load against production. A production read check requires explicit operator approval and `--confirm-production-read-load`.

In staging, separately test 100/500/1000 first anonymous sessions and same-venue signal writes. Confirm global/per-venue budgets reject excess work, signal latency does not grow with active contributor count, one snapshot row exists per venue/bucket, the two-minute cron reconciles within 20 minutes, and database CPU/connections remain below the rollout threshold.
