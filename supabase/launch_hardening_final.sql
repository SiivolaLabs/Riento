-- Apply after schema.sql and seed_venues.sql on an existing project.
-- This file must remain the last function/grant/policy override before cron.

set check_function_bodies = on;

create or replace function public.refresh_crowd_snapshots(p_window_minutes integer default 90)
returns integer
language sql
security definer
set search_path = pg_catalog, public
as $$
  select public.launch_refresh_crowd_snapshots(p_window_minutes);
$$;

create or replace function public.refresh_venue_crowd_snapshot(
  p_venue_id uuid,
  p_window_minutes integer default 90
)
returns public.crowd_level
language sql
security definer
set search_path = pg_catalog, public
as $$
  select public.launch_refresh_venue_crowd_snapshot(p_venue_id, p_window_minutes);
$$;

create or replace function public.submit_venue_signal(
  p_venue_id uuid,
  p_source public.signal_source,
  p_confidence numeric default 1
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  select public.launch_submit_venue_signal(p_venue_id, p_source, p_confidence);
$$;

create or replace function public.get_venue_review_summaries()
returns table (venue_id uuid, average_rating numeric, review_count integer)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select * from public.launch_get_venue_review_summaries();
$$;

drop function if exists public.get_public_venue_reviews(uuid, integer);
create function public.get_public_venue_reviews(
  p_venue_id uuid,
  p_limit integer default 20
)
returns table (
  id uuid,
  venue_id uuid,
  rating integer,
  comment text,
  updated_at timestamptz,
  moderation_status text,
  is_own boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select * from public.launch_get_public_venue_reviews(p_venue_id, p_limit);
$$;

create or replace function public.claim_music_recognition_attempt(p_venue_id uuid)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  select public.launch_claim_music_recognition_attempt(p_venue_id);
$$;

create or replace function public.submit_venue_music_report(
  p_venue_id uuid,
  p_track_title text,
  p_artist_name text default null,
  p_report_source public.now_playing_source default 'user_confirmation'::public.now_playing_source
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  select public.launch_submit_venue_music_report(
    p_venue_id,
    p_track_title,
    p_artist_name,
    p_report_source
  );
$$;

create or replace function public.submit_music_match_feedback(
  p_venue_id uuid,
  p_track_title text,
  p_artist_name text,
  p_is_correct boolean
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  select public.launch_submit_music_match_feedback(
    p_venue_id,
    p_track_title,
    p_artist_name,
    p_is_correct
  );
$$;

create or replace function public.set_admin_venue_now_playing(
  p_venue_id uuid,
  p_track_title text,
  p_artist_name text default null
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  select public.launch_set_admin_venue_now_playing(
    p_venue_id,
    p_track_title,
    p_artist_name
  );
$$;

revoke execute on function public.refresh_crowd_snapshots(integer) from public, anon, authenticated;
grant execute on function public.refresh_crowd_snapshots(integer) to service_role;
revoke execute on function public.refresh_venue_crowd_snapshot(uuid, integer) from public, anon, authenticated;
grant execute on function public.refresh_venue_crowd_snapshot(uuid, integer) to service_role;
revoke execute on function public.submit_venue_signal(uuid, public.signal_source, numeric) from public, anon;
grant execute on function public.submit_venue_signal(uuid, public.signal_source, numeric) to authenticated;
revoke execute on function public.get_venue_review_summaries() from public;
grant execute on function public.get_venue_review_summaries() to anon, authenticated;
revoke execute on function public.get_public_venue_reviews(uuid, integer) from public;
grant execute on function public.get_public_venue_reviews(uuid, integer) to anon, authenticated;
revoke execute on function public.claim_music_recognition_attempt(uuid) from public;
grant execute on function public.claim_music_recognition_attempt(uuid) to authenticated;
revoke execute on function public.submit_venue_music_report(uuid, text, text, public.now_playing_source) from public;
grant execute on function public.submit_venue_music_report(uuid, text, text, public.now_playing_source) to authenticated;
revoke execute on function public.submit_music_match_feedback(uuid, text, text, boolean) from public;
grant execute on function public.submit_music_match_feedback(uuid, text, text, boolean) to authenticated;
revoke execute on function public.set_admin_venue_now_playing(uuid, text, text) from public;
grant execute on function public.set_admin_venue_now_playing(uuid, text, text) to authenticated;

-- Clear legacy client-trusted public music while preserving private reports.
delete from public.venue_now_playing
where source = 'user_confirmation'
   or (source = 'user_audio_match' and observed_at < '2026-08-01 00:00:00+00'::timestamptz);

delete from public.venue_music_observations
where source = 'user_confirmation'
   or (source = 'user_audio_match' and observed_at < '2026-08-01 00:00:00+00'::timestamptz);

create or replace function public.get_public_venue_now_playing()
returns table (venue_id uuid, track_title text, artist_name text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select current_track.venue_id, current_track.track_title, current_track.artist_name
  from public.venue_now_playing current_track
  where current_track.expires_at > now()
    and current_track.source in (
      'manual'::public.now_playing_source,
      'user_audio_match'::public.now_playing_source,
      'venue_spotify'::public.now_playing_source
    )
  order by current_track.venue_id;
$$;

create or replace function public.get_public_venue_music_history(p_venue_id uuid)
returns table (
  period_name text,
  item_type text,
  track_title text,
  artist_name text,
  genre text,
  item_rank integer
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with periods(period_name, since_at) as (
    values
      ('daily'::text, now() - interval '24 hours'),
      ('monthly'::text, now() - interval '30 days')
  ),
  trusted_observations as (
    select observations.track_title, observations.artist_name, observations.genre, observations.observed_at
    from public.venue_music_observations observations
    where observations.venue_id = p_venue_id
      and observations.observed_at >= now() - interval '30 days'
      and observations.source in (
        'manual'::public.now_playing_source,
        'user_audio_match'::public.now_playing_source,
        'venue_spotify'::public.now_playing_source
      )
  ),
  track_counts as (
    select periods.period_name, observations.track_title, observations.artist_name,
      count(*) as observation_count, max(observations.observed_at) as latest_observation
    from periods
    join trusted_observations observations on observations.observed_at >= periods.since_at
    group by periods.period_name, observations.track_title, observations.artist_name
  ),
  ranked_tracks as (
    select *, row_number() over (
      partition by period_name
      order by observation_count desc, latest_observation desc, track_title
    )::integer as item_rank
    from track_counts
  ),
  genre_counts as (
    select periods.period_name, observations.genre,
      count(*) as observation_count, max(observations.observed_at) as latest_observation
    from periods
    join trusted_observations observations on observations.observed_at >= periods.since_at
    where observations.genre is not null and btrim(observations.genre) <> ''
    group by periods.period_name, observations.genre
  ),
  ranked_genres as (
    select *, row_number() over (
      partition by period_name
      order by observation_count desc, latest_observation desc, genre
    )::integer as item_rank
    from genre_counts
  )
  select tracks.period_name, 'track'::text as item_type, tracks.track_title, tracks.artist_name, null::text, tracks.item_rank
  from ranked_tracks tracks
  where tracks.item_rank <= 5
  union all
  select genres.period_name, 'genre'::text, null::text, null::text, genres.genre, genres.item_rank
  from ranked_genres genres
  where genres.item_rank <= 5
  order by period_name, item_type, item_rank;
$$;

revoke execute on function public.get_public_venue_now_playing() from public;
grant execute on function public.get_public_venue_now_playing() to anon, authenticated;
revoke execute on function public.get_public_venue_music_history(uuid) from public;
grant execute on function public.get_public_venue_music_history(uuid) to anon, authenticated;

drop policy if exists "venue_now_playing_public_read" on public.venue_now_playing;
drop policy if exists "venue_music_observations_public_read" on public.venue_music_observations;
revoke all on table public.venue_now_playing, public.venue_music_observations from public, anon, authenticated;
grant all on table public.venue_now_playing, public.venue_music_observations to service_role;
drop policy if exists "venue_music_reports_insert_own" on public.venue_music_reports;
revoke all on table public.venue_music_reports from public, anon, authenticated;
grant all on table public.venue_music_reports to service_role;
revoke all on table public.admin_music_actions from public, anon, authenticated;
grant all on table public.admin_music_actions to service_role;
alter table public.venue_now_playing enable row level security;
alter table public.venue_music_observations enable row level security;
alter table public.venue_music_reports enable row level security;
alter table public.admin_music_actions enable row level security;

create or replace function public.get_launch_music_security_status()
returns table (music_tables_private boolean)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select not (
    has_table_privilege('anon', 'public.venue_now_playing', 'SELECT')
    or has_table_privilege('anon', 'public.venue_now_playing', 'INSERT')
    or has_table_privilege('anon', 'public.venue_now_playing', 'UPDATE')
    or has_table_privilege('anon', 'public.venue_now_playing', 'DELETE')
    or has_table_privilege('anon', 'public.venue_now_playing', 'TRUNCATE')
    or has_table_privilege('authenticated', 'public.venue_now_playing', 'SELECT')
    or has_table_privilege('authenticated', 'public.venue_now_playing', 'INSERT')
    or has_table_privilege('authenticated', 'public.venue_now_playing', 'UPDATE')
    or has_table_privilege('authenticated', 'public.venue_now_playing', 'DELETE')
    or has_table_privilege('authenticated', 'public.venue_now_playing', 'TRUNCATE')
    or has_table_privilege('anon', 'public.venue_music_observations', 'SELECT')
    or has_table_privilege('anon', 'public.venue_music_observations', 'INSERT')
    or has_table_privilege('anon', 'public.venue_music_observations', 'UPDATE')
    or has_table_privilege('anon', 'public.venue_music_observations', 'DELETE')
    or has_table_privilege('anon', 'public.venue_music_observations', 'TRUNCATE')
    or has_table_privilege('authenticated', 'public.venue_music_observations', 'SELECT')
    or has_table_privilege('authenticated', 'public.venue_music_observations', 'INSERT')
    or has_table_privilege('authenticated', 'public.venue_music_observations', 'UPDATE')
    or has_table_privilege('authenticated', 'public.venue_music_observations', 'DELETE')
    or has_table_privilege('authenticated', 'public.venue_music_observations', 'TRUNCATE')
    or has_table_privilege('anon', 'public.venue_music_reports', 'SELECT')
    or has_table_privilege('anon', 'public.venue_music_reports', 'INSERT')
    or has_table_privilege('anon', 'public.venue_music_reports', 'UPDATE')
    or has_table_privilege('anon', 'public.venue_music_reports', 'DELETE')
    or has_table_privilege('anon', 'public.venue_music_reports', 'TRUNCATE')
    or has_table_privilege('authenticated', 'public.venue_music_reports', 'SELECT')
    or has_table_privilege('authenticated', 'public.venue_music_reports', 'INSERT')
    or has_table_privilege('authenticated', 'public.venue_music_reports', 'UPDATE')
    or has_table_privilege('authenticated', 'public.venue_music_reports', 'DELETE')
    or has_table_privilege('authenticated', 'public.venue_music_reports', 'TRUNCATE')
    or has_table_privilege('anon', 'public.admin_music_actions', 'SELECT')
    or has_table_privilege('anon', 'public.admin_music_actions', 'INSERT')
    or has_table_privilege('anon', 'public.admin_music_actions', 'UPDATE')
    or has_table_privilege('anon', 'public.admin_music_actions', 'DELETE')
    or has_table_privilege('anon', 'public.admin_music_actions', 'TRUNCATE')
    or has_table_privilege('authenticated', 'public.admin_music_actions', 'SELECT')
    or has_table_privilege('authenticated', 'public.admin_music_actions', 'INSERT')
    or has_table_privilege('authenticated', 'public.admin_music_actions', 'UPDATE')
    or has_table_privilege('authenticated', 'public.admin_music_actions', 'DELETE')
    or has_table_privilege('authenticated', 'public.admin_music_actions', 'TRUNCATE')
    or not coalesce((select relrowsecurity from pg_class where oid = 'public.venue_now_playing'::regclass), false)
    or not coalesce((select relrowsecurity from pg_class where oid = 'public.venue_music_observations'::regclass), false)
    or not coalesce((select relrowsecurity from pg_class where oid = 'public.venue_music_reports'::regclass), false)
    or not coalesce((select relrowsecurity from pg_class where oid = 'public.admin_music_actions'::regclass), false)
  );
$$;

revoke execute on function public.get_launch_music_security_status() from public;
grant execute on function public.get_launch_music_security_status() to anon, authenticated;

drop policy if exists "account_deletion_requests_select_own" on public.account_deletion_requests;
drop policy if exists "account_deletion_requests_insert_own" on public.account_deletion_requests;
drop policy if exists "account_deletion_requests_cancel_own" on public.account_deletion_requests;
drop policy if exists "data_export_requests_select_own" on public.data_export_requests;
drop policy if exists "data_export_requests_insert_own" on public.data_export_requests;
drop policy if exists "data_export_requests_cancel_own" on public.data_export_requests;
revoke all on table public.account_deletion_requests, public.data_export_requests from public, anon, authenticated;
grant all on table public.account_deletion_requests, public.data_export_requests to service_role;
revoke all on table public.launch_runtime_controls, public.launch_rate_buckets from public, anon, authenticated;
grant all on table public.launch_runtime_controls, public.launch_rate_buckets to service_role;

create or replace function public.get_admin_status()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null
    and not public.current_user_is_anonymous()
    and exists (select 1 from public.app_admins where user_id = auth.uid());
$$;

revoke execute on function public.get_admin_status() from public;
grant execute on function public.get_admin_status() to authenticated;

create table if not exists public.public_venue_enrichment_cache (
  singleton boolean primary key default true check (singleton),
  payload jsonb not null,
  refreshed_at timestamptz not null default statement_timestamp()
);

alter table public.public_venue_enrichment_cache enable row level security;

drop policy if exists "public_venue_enrichment_cache_read" on public.public_venue_enrichment_cache;
create policy "public_venue_enrichment_cache_read"
on public.public_venue_enrichment_cache for select
to anon, authenticated
using (true);

revoke all on table public.public_venue_enrichment_cache from public, anon, authenticated;
grant select (payload, refreshed_at) on table public.public_venue_enrichment_cache to anon, authenticated;
grant all on table public.public_venue_enrichment_cache to service_role;

create or replace function public.build_public_venue_enrichment_payload()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select pg_catalog.jsonb_build_object(
    'crowd_snapshots',
    coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', snapshots.id,
          'venue_id', snapshots.venue_id,
          'crowd_level', snapshots.crowd_level,
          'has_signal', snapshots.has_signal,
          'created_at', snapshots.created_at,
          'snapshot_rank', snapshots.snapshot_rank
        ) order by snapshots.venue_id, snapshots.snapshot_rank
      )
      from public.get_latest_crowd_snapshots() snapshots
    ), pg_catalog.jsonb_build_array()),
    'now_playing',
    coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'venue_id', now_playing.venue_id,
          'track_title', now_playing.track_title,
          'artist_name', now_playing.artist_name
        ) order by now_playing.venue_id
      )
      from public.get_public_venue_now_playing() now_playing
    ), pg_catalog.jsonb_build_array()),
    'rating_summaries',
    coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'venue_id', ratings.venue_id,
          'average_rating', ratings.average_rating,
          'review_count', ratings.review_count
        ) order by ratings.venue_id
      )
      from public.get_venue_review_summaries() ratings
    ), pg_catalog.jsonb_build_array()),
    'trending_venues',
    coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'venue_id', trending.venue_id,
          'sort_rank', trending.sort_rank,
          'headline', trending.headline,
          'expires_at', trending.expires_at
        ) order by trending.sort_rank, trending.venue_id
      )
      from public.get_curated_trending_venues() trending
    ), pg_catalog.jsonb_build_array())
  );
$$;

revoke execute on function public.build_public_venue_enrichment_payload() from public, anon, authenticated;
grant execute on function public.build_public_venue_enrichment_payload() to service_role;

create or replace function public.refresh_public_venue_enrichment_cache()
returns timestamptz
language sql
volatile
security definer
set search_path = pg_catalog
as $$
  insert into public.public_venue_enrichment_cache (singleton, payload, refreshed_at)
  values (true, public.build_public_venue_enrichment_payload(), statement_timestamp())
  on conflict (singleton) do update
  set payload = excluded.payload,
      refreshed_at = excluded.refreshed_at
  returning refreshed_at;
$$;

revoke execute on function public.refresh_public_venue_enrichment_cache() from public, anon, authenticated;
grant execute on function public.refresh_public_venue_enrichment_cache() to service_role;

create or replace function public.refresh_crowd_snapshots(p_window_minutes integer default 90)
returns integer
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_refreshed integer;
begin
  v_refreshed := public.launch_refresh_crowd_snapshots(p_window_minutes);
  perform public.refresh_public_venue_enrichment_cache();
  return v_refreshed;
end;
$$;

revoke execute on function public.refresh_crowd_snapshots(integer) from public, anon, authenticated;
grant execute on function public.refresh_crowd_snapshots(integer) to service_role;

select public.refresh_public_venue_enrichment_cache();

create or replace function public.get_public_venue_enrichments()
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select coalesce(
    (select cache.payload from public.public_venue_enrichment_cache cache limit 1),
    pg_catalog.jsonb_build_object(
      'crowd_snapshots', pg_catalog.jsonb_build_array(),
      'now_playing', pg_catalog.jsonb_build_array(),
      'rating_summaries', pg_catalog.jsonb_build_array(),
      'trending_venues', pg_catalog.jsonb_build_array()
    )
  );
$$;

revoke execute on function public.get_public_venue_enrichments() from public;
grant execute on function public.get_public_venue_enrichments() to anon, authenticated;

create or replace function public.get_public_venue_enrichment_cache_status()
returns table (refreshed_at timestamptz, cache_age_seconds integer)
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select
    cache.refreshed_at,
    greatest(0, extract(epoch from statement_timestamp() - cache.refreshed_at)::integer)
  from public.public_venue_enrichment_cache cache
  limit 1;
$$;

revoke execute on function public.get_public_venue_enrichment_cache_status() from public;
grant execute on function public.get_public_venue_enrichment_cache_status() to anon, authenticated;
