# Venue Report Review Runbook

Status: current operational default. Final legal/privacy review is still required before production launch.

## Purpose
Riento users can submit private reports for wrong venue data, wrong crowd labels, closed/duplicate venues, and missing venues. Reports are stored in `public.venue_reports` and should be reviewed before changing production venue data.

Operational defaults for launch:
- Limit venue-report review to a small named operator group.
- Review reports only from a restricted support/admin machine or shell session.
- Keep raw report details private in support tooling and internal discussion.
- Treat venue reports as review inputs, not automatic truth. A report should not change production venue data without source checks.
- Retain resolved venue-report rows as private audit history until legal/privacy review defines a shorter or longer retention window.
- Use the same approved support log or ticketing system that tracks export/deletion actions.

## Pending Reports
List unresolved reports:

```sql
select
  venue_reports.id,
  venue_reports.reason,
  venue_reports.details,
  venue_reports.created_at,
  venues.slug,
  venues.name,
  venues.address,
  venues.neighborhood,
  venues.verification_status
from public.venue_reports
left join public.venues on venues.id = venue_reports.venue_id
where venue_reports.resolved_at is null
order by venue_reports.created_at asc;
```

List missing venue reports:

```sql
select id, details, created_at
from public.venue_reports
where reason = 'missing_venue'
  and resolved_at is null
order by created_at asc;
```

## Review Checklist
- Verify the venue exists and is currently operating.
- Verify official name, street address, neighborhood, kind, coordinates, rough capacity, and opening hours.
- Check whether the report points to a duplicate venue row.
- Avoid importing third-party data unless source terms and attribution obligations are understood.
- Keep user report details private; do not expose them in public app surfaces.

Identity and abuse checks before acting on a report:
1. Confirm the report came through a valid private device session.
2. Review the report reason, created time, and venue context before making any venue change.
3. If multiple recent reports point to the same issue, review them together before editing venue data.
4. If a report looks abusive, incoherent, or intentionally misleading, do not update venue data from it alone.

Approved evidence sources:
- Official venue website or official social profile.
- Direct venue communication.
- On-the-ground verification by a trusted operator.
- Trusted map/place datasets only when their usage terms and attribution obligations are acceptable for production.

Do not treat the following as sufficient on their own:
- A single unverified user report.
- Scraped Google Maps live busyness/popular-times data.
- Unsourced copied venue metadata.

## Mark A Report Resolved
After reviewing and applying any venue changes, dry-run the resolution from a trusted terminal:

```sh
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key npm run admin:resolve-venue-report -- report-id
```

Mark the report resolved after confirming review is complete:

```sh
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key npm run admin:resolve-venue-report -- report-id --confirm-resolve --confirm-report-id report-id
```

Manual SQL equivalent:

```sql
update public.venue_reports
set resolved_at = now()
where id = 'report-id';
```

The admin script is dry-run by default, requires re-confirming the exact report id before resolving, and refuses to re-resolve a report that changed while processing.

Standard resolution flow:
1. Review the report details and venue context.
2. Verify the issue from an approved evidence source.
3. Apply the necessary venue-data change, if any.
4. Record what evidence justified the change in the support log or ticket.
5. Dry-run the resolver script.
6. Re-run with `--confirm-resolve --confirm-report-id <report-id>`.
7. Confirm the row is resolved and record the completion time.

## Now-Playing Reports
List unresolved now-playing confirmations:

```sql
select
  venue_music_reports.id,
  venue_music_reports.track_title,
  venue_music_reports.artist_name,
  venue_music_reports.report_source,
  venue_music_reports.feedback_is_correct,
  venue_music_reports.created_at,
  venues.slug,
  venues.name
from public.venue_music_reports
join public.venues on venues.id = venue_music_reports.venue_id
where venue_music_reports.resolved_at is null
order by venue_music_reports.created_at asc;
```

Dry-run a report promotion from a trusted terminal:

```sh
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key npm run admin:set-now-playing -- --report-id report-id
```

Promote a reviewed report into public venue-level now-playing status:

```sh
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key npm run admin:set-now-playing -- --report-id report-id --confirm-set --confirm-report-id report-id
```

Set a trusted manual sample or venue-authorized playback row directly:

```sh
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key npm run admin:set-now-playing -- --venue-slug venue-slug --title "Track title" --artist "Artist" --source manual --confirm-set --confirm-venue-slug venue-slug
```

Now-playing rows expire by default after 45 minutes. User Yes/No feedback stays private and cannot change public music; never promote a `feedback_is_correct = false` row. iOS ShazamKit matches stay local unless the user sends private feedback. Android ACRCloud metadata publishes only inside the trusted Edge Function through a single-use service-role RPC. Allow-listed app admins can publish manually verified songs through the fixed `set_admin_venue_now_playing()` RPC; retain the service-role script for exceptional corrections. Keep identity/private details out of public screens.

Default promotion rules for now-playing reports:
- In launch mode, only trusted Android provider publication or an authorized admin update creates a venue-level music signal.
- Prefer multiple matching reports, trusted operator observation, or other supporting evidence when correcting stale, disputed, or suspicious rows.
- Do not publish public now-playing rows directly from an uncertain or abusive-looking user report.
- If the report is useful as venue-history context but not reliable enough for current public now-playing, correct it with the admin script or leave it as private audit context.

## Common Venue Updates
Mark a venue closed:

```sql
update public.venues
set verification_status = 'closed', updated_at = now()
where slug = 'venue-slug';
```

Mark a venue duplicate:

```sql
update public.venues
set verification_status = 'duplicate', updated_at = now()
where slug = 'venue-slug';
```

Mark a venue verified after review:

```sql
update public.venues
set verification_status = 'verified', updated_at = now()
where slug = 'venue-slug';
```

Operator notes:
- Mark `closed` only when there is good evidence the venue is no longer operating at that location.
- Mark `duplicate` only when the correct canonical row is known.
- Mark `verified` only after the key metadata has been checked from an approved source.

## Incident And Escalation Rules
- If a report may affect many users quickly, such as a major closure, duplicate venue, or obviously wrong address for a high-traffic venue, prioritize it for same-day review.
- If operator confidence is low, do not change production venue data yet; leave the report unresolved until stronger evidence is available.
- If a venue owner disputes a change, pause further edits until the evidence is reviewed again.

## Remaining Review Before Public Launch
- Confirm who owns the venue-report queue operationally.
- Confirm the retention window for resolved venue reports and reviewed now-playing reports.
- Document attribution obligations before using OpenStreetMap-derived data in production.
- Revisit whether any additional audit fields or admin tooling are needed after early support use.
