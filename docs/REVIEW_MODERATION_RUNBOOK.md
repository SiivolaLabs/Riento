# Written Review Moderation Runbook

Status: required launch operation. Final legal and trust-and-safety review is still required.

## Operating Default
- New and edited written reviews use `moderation_status = 'pending'` and are not public.
- Account-free number ratings are private feedback. Permanent-account ratings enter public summaries only after the three-account minimum is met and any attached text is approved or removed.
- Check the pending queue at least daily.
- Review urgent safety, threat, doxxing, or harassment reports within 24 hours; handle other reports within 72 hours.
- Treat `safety_threat` and `personal_information` categories as urgent without waiting for additional free-form details.
- Never copy account email addresses or private session IDs into public fields or moderation notes.

## Queue Queries
Run in the Supabase SQL editor with trusted operator access:

```sql
select id, venue_id, rating, comment, moderation_status, created_at, updated_at
from public.venue_reviews
where comment is not null
  and moderation_status = 'pending'
order by updated_at asc;
```

```sql
select reports.id, reports.review_id, reports.reason, reports.details, reports.reported_comment, reports.created_at,
       reviews.venue_id, reviews.rating, reviews.comment, reviews.moderation_status
from public.venue_review_reports reports
join public.venue_reviews reviews on reviews.id = reports.review_id
where reports.resolved_at is null
order by reports.created_at asc;
```

## Decision
Approve only venue-specific, useful, respectful text that follows `docs/COMMUNITY_GUIDELINES.md`.

Reject content containing harassment, hate, threats, personal information, sexual exploitation, spam, undisclosed promotion, impersonation, dangerous instructions, knowingly false claims, or unrelated text. Rejection keeps the text and associated rating out of public summaries until the author removes or replaces the text. Escalate credible threats or illegal content according to applicable law; do not investigate users personally.

## Dry Run And Confirmation

First copy a real pending review UUID from the queue query above. In a trusted terminal, enter the service-role key without putting it in shell history:

```sh
export SUPABASE_URL="https://adytflvtwkizparpoazu.supabase.co"
read -s "SUPABASE_SERVICE_ROLE_KEY?Paste Supabase service-role key: "
export SUPABASE_SERVICE_ROLE_KEY
export RIENTO_MODERATOR_ID="pietisiivola"
```

Replace `<real-review-uuid>` below with the UUID from the queue, including the hyphens:

```sh
npm run admin:moderate-review -- <real-review-uuid> approve --reason "Venue-specific and policy-compliant"
```

```sh
npm run admin:moderate-review -- <real-review-uuid> approve --reason "Venue-specific and policy-compliant" --confirm-moderation --confirm-review-id <real-review-uuid>
```

Use `reject` instead of `approve` and provide a concise internal reason when content violates policy. The script verifies the exact review ID, rejects concurrent changes, and resolves open reports after moderation. If report resolution fails after the review update, resolve those report rows manually and document the incident.

## Account Enforcement
The launch app pre-moderates review text and lets users block review authors. For repeated or severe abuse, use trusted Supabase Auth administration to ban the account after documenting the review IDs, policy basis, decision, and operator. Do not ban anonymous device sessions solely because of a disputed crowd or music signal without separate abuse evidence.

## Retention
Resolved written-review reports are deleted after 90 days by `cleanup_review_moderation_data()`. Review text remains until the author replaces/deletes it, an operator removes it, the account is deleted, or another lawful retention decision applies.
