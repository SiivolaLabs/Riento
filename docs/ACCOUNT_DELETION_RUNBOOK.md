# Identity And Data Deletion Runbook

Status: current launch process. Final legal/privacy review remains required.

## User Flow
- Anonymous users tap Settings > Data controls > Delete all Riento data.
- Optional email, Google, or Apple review-account users tap Settings > Data controls > Delete account and all Riento data.
- Both actions call `delete-device-data` with explicit confirmation and a device-generated 256-bit recovery capability.

The first request verifies the bearer token plus exact account type/provider fingerprint before storing only a hash of the recovery capability in the service-role-only `identity_deletion_operations` ledger. A retry can use that capability only to resume the already-authorized operation, including after the Auth user or JWT is gone. The function deletes attributable ratings/reviews, review reports, venue reports, music reports, signals, placements, saved backend rows, and request rows; attempts bounded Apple revocation when a fresh authorization code is present; then deletes the Supabase Auth identity and refreshes broad crowd snapshots. Foreign-key cascades close the final-write race during Auth deletion. The native SDK makes a bounded, subject-matched Google revocation attempt only after Riento deletion is terminal. The app then clears local My spots/preferences and its local session.

## Deployment
Deploy this function with gateway JWT verification disabled so a deleted/expired session can resume by capability:

```sh
npx supabase functions deploy delete-device-data --no-verify-jwt --project-ref PROJECT_REF
```

Do not use `--no-verify-jwt` for other functions by default. `delete-device-data` manually validates a live user with `auth.getUser()` before creating an operation; only an existing random capability can bypass that creation check. The ledger has RLS enabled, grants no app-role access, never stores the raw capability, and clears the target Auth UUID at completion.

Never place `SUPABASE_SERVICE_ROLE_KEY` in the app or `EXPO_PUBLIC_*` variables.

Set `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and `APPLE_PRIVATE_KEY` as Supabase secrets. The Apple private key must never be placed in the repository, mobile app, or EAS public environment.

## Verification
1. Delete a fresh anonymous identity with a rating, crowd signal, and music report.
2. Confirm its Auth user and attributable rows are gone.
3. Delete a permanent email review account containing pending/approved review text and a review report/block.
4. Confirm the Auth account, review text, report rows, and block rows are gone.
5. Delete Google and Apple accounts and confirm provider access is revoked in the relevant provider console/settings.
6. Force provider revocation failure and confirm Riento data deletion still finishes with a clear manual-revocation message.
7. Confirm the app returns to account-free browsing and does not create a replacement identity until another server contribution.
8. Confirm crowd labels reconcile immediately or on the next two-minute job.
9. Drop the first successful HTTP response, remove/expire the local JWT, and confirm retrying with the same device capability returns terminal completion without creating a second identity.
10. Confirm anon/authenticated roles cannot read `identity_deletion_operations` and completed rows contain no target UUID or Apple subject.

## Support Failure
If in-app deletion fails, ask the user not to reset or reinstall while the saved recovery capability is still available, then retry after service recovery. A local reset explicitly abandons an unreadable capability and must not claim inaccessible server data was deleted. For an outside-app permanent-account request, require control of the account email or Apple relay email, record the request date, and complete it within 30 days. Outside-app deletion cannot automatically revoke Google/Apple access without fresh authorization; instruct the user to remove Riento in provider account settings.

After verification, run a dry lookup:

```sh
SUPABASE_URL=https://PROJECT.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
npm run admin:delete-review-account -- ACCOUNT_EMAIL
```

Reconfirm the exact UUID printed by the dry run:

```sh
SUPABASE_URL=https://PROJECT.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
npm run admin:delete-review-account -- ACCOUNT_EMAIL --confirm-delete-account --confirm-user-id USER_ID
```

For a lost anonymous session, do not claim that Riento can relink pseudonymous records to the person.

Document any manual deletion with timestamp, identity UUID, operator, affected tables, and outcome without copying review content or credentials into the audit note.
