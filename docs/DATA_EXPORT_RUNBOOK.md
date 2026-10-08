# Direct Data Export Runbook

Status: current launch process. Final legal/privacy review remains required.

Settings exports the current identity's RLS-readable server contributions directly as JSON and adds device-local My spots/preferences. No support request row, email delivery, or admin-generated artifact is used for the normal flow.

The export can include:
- Private session UUID, optional account email/relay email, and authentication-provider names
- Venue signals and manual placements
- Ratings, written review text, and moderation status/timestamps owned by the identity; private operator moderation notes are not returned by the direct export RPC
- Review reports and a count of reviewer blocks created by the identity; another user's private Auth UUID is not exported
- Private venue and music reports, including venue/song Yes/No accuracy feedback
- Local My spots and settings

## Verification
1. Before any contribution, export explains that no server identity exists.
2. Anonymous export returns only rows owned by the current anonymous UUID.
3. Permanent-account export includes its email, provider names, and own written-review status/timestamps, but not provider tokens, private operator notes, or another user's Auth UUID.
4. Another identity's private rows, moderation reports, email/provider metadata, and blocks are inaccessible.
5. The share sheet opens only after all queries succeed; a partial export is not presented as complete.

Exports are created in memory for the user-initiated share sheet. Riento does not intentionally upload or retain a generated export file. The user controls any destination selected in the platform share sheet.

If the direct export fails, fix the RLS/query issue before offering an operator-created artifact. Any exceptional support export requires verified account control, encrypted delivery, a short deletion deadline, and a documented operator.
