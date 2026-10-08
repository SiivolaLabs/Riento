create extension if not exists pgcrypto;

do $$
begin
  create type public.venue_kind as enum ('bar', 'club');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.venue_source as enum ('manual', 'openstreetmap', 'google_places', 'foursquare');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.venue_verification_status as enum ('needs_verification', 'verified', 'closed', 'duplicate');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.crowd_level as enum ('quiet', 'active', 'busy', 'packed');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.signal_source as enum ('gps', 'manual');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.now_playing_source as enum ('manual', 'user_audio_match', 'user_confirmation', 'venue_spotify');
exception
  when duplicate_object then null;
end $$;

-- Define this before any admin function or policy references it so clean
-- bootstrap execution does not depend on an earlier incremental deployment.
create or replace function public.current_user_is_anonymous()
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true';
$$;

revoke execute on function public.current_user_is_anonymous() from public;
grant execute on function public.current_user_is_anonymous() to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique,
  avatar_url text,
  gps_on_map_open boolean not null default true,
  manual_placement_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  kind public.venue_kind not null,
  address text not null,
  neighborhood text not null,
  latitude double precision not null,
  longitude double precision not null,
  capacity_estimate integer check (capacity_estimate > 0),
  source public.venue_source not null default 'manual',
  source_external_id text,
  source_checked_at date,
  verification_status public.venue_verification_status not null default 'needs_verification',
  opening_hours jsonb not null default '{}'::jsonb,
  vibe text not null default '',
  sound_tags text[] not null default array['unknown']::text[] check (sound_tags <@ array['dance-pop', 'electronic', 'jazz', 'karaoke', 'live-music', 'mixed', 'rock', 'unknown']::text[]),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.venues
add column if not exists source_external_id text,
add column if not exists source_checked_at date,
add column if not exists opening_hours jsonb not null default '{}'::jsonb,
add column if not exists vibe text not null default '',
add column if not exists sound_tags text[] not null default array['unknown']::text[];

update public.venues
set sound_tags = array['unknown']::text[]
where not (sound_tags <@ array['dance-pop', 'electronic', 'jazz', 'karaoke', 'live-music', 'mixed', 'rock', 'unknown']::text[]);

alter table public.venues drop constraint if exists venues_sound_tags_check;
alter table public.venues add constraint venues_sound_tags_check
check (sound_tags <@ array['dance-pop', 'electronic', 'jazz', 'karaoke', 'live-music', 'mixed', 'rock', 'unknown']::text[]);

create table if not exists public.venue_pings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  venue_id uuid not null references public.venues (id) on delete cascade,
  source public.signal_source not null,
  confidence numeric(4, 3) not null default 1 check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 minutes')
);

create table if not exists public.manual_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  venue_id uuid not null references public.venues (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 minutes')
);

create table if not exists public.crowd_snapshots (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  crowd_level public.crowd_level not null,
  has_signal boolean not null default false,
  signal_score numeric(5, 4) not null check (signal_score >= 0 and signal_score <= 1),
  sample_size integer not null default 0 check (sample_size >= 0),
  window_start timestamptz not null,
  window_end timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.crowd_snapshots
add column if not exists has_signal boolean not null default false;

update public.crowd_snapshots
set has_signal = sample_size > 0 or signal_score > 0
where has_signal is distinct from (sample_size > 0 or signal_score > 0);

create table if not exists public.venue_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  venue_id uuid references public.venues (id) on delete cascade,
  reason text not null,
  details text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.venue_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  venue_id uuid not null references public.venues (id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text check (comment is null or length(btrim(comment)) <= 700),
  hidden_at timestamptz,
  hidden_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_saved_venues (
  user_id uuid not null references auth.users (id) on delete cascade,
  venue_id uuid not null references public.venues (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, venue_id)
);

create table if not exists public.admin_venue_signals (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  admin_user_id uuid references auth.users (id) on delete cascade,
  crowd_level public.crowd_level not null,
  signal_score numeric(5, 4) not null check (signal_score >= 0 and signal_score <= 1),
  note text check (note is null or length(btrim(note)) <= 500),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 minutes'),
  check (expires_at > created_at)
);

create table if not exists public.curated_trending_venues (
  venue_id uuid primary key references public.venues (id) on delete cascade,
  headline text check (headline is null or length(btrim(headline)) <= 120),
  sort_rank integer not null default 100 check (sort_rank >= 1 and sort_rank <= 999),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_by uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > starts_at)
);

create table if not exists public.venue_now_playing (
  venue_id uuid primary key references public.venues (id) on delete cascade,
  track_title text not null check (length(btrim(track_title)) > 0),
  artist_name text,
  album_name text,
  spotify_track_id text,
  source public.now_playing_source not null,
  confidence numeric(4, 3) not null default 0.5 check (confidence >= 0 and confidence <= 1),
  observed_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '45 minutes'),
  updated_at timestamptz not null default now(),
  check (expires_at > observed_at)
);

create table if not exists public.venue_music_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  venue_id uuid not null references public.venues (id) on delete cascade,
  track_title text not null check (length(btrim(track_title)) > 0),
  artist_name text,
  report_source public.now_playing_source not null default 'user_confirmation',
  feedback_is_correct boolean,
  details text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check (report_source in ('user_audio_match'::public.now_playing_source, 'user_confirmation'::public.now_playing_source))
);

alter table public.venue_music_reports
add column if not exists feedback_is_correct boolean;

alter table public.venue_music_reports
drop constraint if exists venue_music_reports_feedback_owner_check;
alter table public.venue_music_reports
add constraint venue_music_reports_feedback_owner_check
check (feedback_is_correct is null or user_id is not null);

create table if not exists public.venue_music_observations (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  track_title text not null check (length(btrim(track_title)) > 0),
  artist_name text,
  genre text,
  source public.now_playing_source not null,
  confidence numeric(4, 3) not null default 0.7 check (confidence >= 0 and confidence <= 1),
  observed_at timestamptz not null default now(),
  spotify_track_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_music_actions (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  admin_user_id uuid references auth.users (id) on delete set null,
  track_title text not null check (char_length(btrim(track_title)) between 1 and 200),
  artist_name text check (artist_name is null or char_length(btrim(artist_name)) <= 200),
  created_at timestamptz not null default now()
);

alter table public.admin_music_actions enable row level security;
revoke all on table public.admin_music_actions from public, anon, authenticated;
grant all on table public.admin_music_actions to service_role;
create index if not exists admin_music_actions_created_at_idx on public.admin_music_actions (created_at);
create index if not exists admin_music_actions_venue_created_idx on public.admin_music_actions (venue_id, created_at desc);

create table if not exists public.music_recognition_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  venue_id uuid not null references public.venues (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists music_recognition_attempts_user_created_idx
on public.music_recognition_attempts (user_id, created_at desc);

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  requested_email text,
  status text not null default 'requested' check (status in ('requested', 'processing', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.identity_deletion_operations (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid,
  operation_token_hash text not null unique check (operation_token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'processing' check (status in ('processing', 'completed')),
  data_deleted_at timestamptz,
  auth_deleted_at timestamptz,
  completed_at timestamptz,
  provider_revocation_status text not null check (provider_revocation_status in ('pending', 'attempting', 'failed', 'not_needed', 'succeeded')),
  provider_revocation_started_at timestamptz,
  apple_subject text,
  google_revocation_required boolean not null default false,
  last_error_code text check (last_error_code is null or length(last_error_code) <= 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'processing' and target_user_id is not null) or (status = 'completed' and target_user_id is null))
);

alter table public.identity_deletion_operations enable row level security;
revoke all on table public.identity_deletion_operations from public, anon, authenticated;
grant all on table public.identity_deletion_operations to service_role;

create table if not exists public.data_export_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  requested_email text,
  status text not null default 'requested' check (status in ('requested', 'processing', 'completed', 'cancelled')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.venue_reports drop constraint if exists venue_reports_user_id_fkey;
alter table public.venue_reports add constraint venue_reports_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade;
alter table public.venue_reviews drop constraint if exists venue_reviews_user_id_fkey;
alter table public.venue_reviews add constraint venue_reviews_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade;
alter table public.admin_venue_signals drop constraint if exists admin_venue_signals_admin_user_id_fkey;
alter table public.admin_venue_signals add constraint admin_venue_signals_admin_user_id_fkey foreign key (admin_user_id) references auth.users (id) on delete cascade;
alter table public.curated_trending_venues drop constraint if exists curated_trending_venues_created_by_fkey;
alter table public.curated_trending_venues add constraint curated_trending_venues_created_by_fkey foreign key (created_by) references auth.users (id) on delete cascade;
alter table public.venue_music_reports drop constraint if exists venue_music_reports_user_id_fkey;
alter table public.venue_music_reports add constraint venue_music_reports_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade;
alter table public.account_deletion_requests drop constraint if exists account_deletion_requests_user_id_fkey;
alter table public.account_deletion_requests add constraint account_deletion_requests_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade;
alter table public.data_export_requests drop constraint if exists data_export_requests_user_id_fkey;
alter table public.data_export_requests add constraint data_export_requests_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade;

create index if not exists venues_kind_idx on public.venues (kind);
create index if not exists venues_neighborhood_idx on public.venues (neighborhood);
create index if not exists venues_location_idx on public.venues (latitude, longitude);
create index if not exists venue_pings_venue_created_idx on public.venue_pings (venue_id, created_at desc);
create index if not exists venue_pings_user_active_idx on public.venue_pings (user_id, expires_at desc);
create index if not exists manual_checkins_user_active_idx on public.manual_checkins (user_id, expires_at desc);
create index if not exists crowd_snapshots_venue_created_idx on public.crowd_snapshots (venue_id, created_at desc);
create index if not exists venue_reports_venue_created_idx on public.venue_reports (venue_id, created_at desc);
create index if not exists venue_reports_user_created_idx on public.venue_reports (user_id, created_at desc);
create index if not exists venue_reviews_venue_created_idx on public.venue_reviews (venue_id, created_at desc);
create index if not exists venue_reviews_user_created_idx on public.venue_reviews (user_id, created_at desc);
create index if not exists venue_reviews_public_idx on public.venue_reviews (venue_id, created_at desc) where hidden_at is null;
create index if not exists user_saved_venues_user_created_idx on public.user_saved_venues (user_id, created_at desc);
create index if not exists user_saved_venues_venue_idx on public.user_saved_venues (venue_id);
create index if not exists admin_venue_signals_venue_expires_idx on public.admin_venue_signals (venue_id, expires_at desc);
create index if not exists admin_venue_signals_admin_created_idx on public.admin_venue_signals (admin_user_id, created_at desc);
create index if not exists curated_trending_venues_active_idx on public.curated_trending_venues (starts_at, expires_at, sort_rank);
create index if not exists venue_now_playing_expires_idx on public.venue_now_playing (expires_at desc);
create index if not exists venue_music_reports_venue_created_idx on public.venue_music_reports (venue_id, created_at desc);
create index if not exists venue_music_reports_user_created_idx on public.venue_music_reports (user_id, created_at desc);
create index if not exists venue_music_observations_venue_observed_idx on public.venue_music_observations (venue_id, observed_at desc);
create index if not exists venue_music_observations_genre_idx on public.venue_music_observations (genre) where genre is not null;
create unique index if not exists account_deletion_requests_user_active_idx
on public.account_deletion_requests (user_id)
where status in ('requested', 'processing');
create index if not exists account_deletion_requests_status_created_idx on public.account_deletion_requests (status, created_at desc);
create index if not exists identity_deletion_operations_status_updated_idx
on public.identity_deletion_operations (status, updated_at desc);
create unique index if not exists data_export_requests_user_active_idx
on public.data_export_requests (user_id)
where status in ('requested', 'processing');
create index if not exists data_export_requests_status_created_idx on public.data_export_requests (status, created_at desc);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_venues_updated_at on public.venues;
create trigger set_venues_updated_at
before update on public.venues
for each row execute function public.set_updated_at();

drop trigger if exists set_venue_reviews_updated_at on public.venue_reviews;
create trigger set_venue_reviews_updated_at
before update on public.venue_reviews
for each row execute function public.set_updated_at();

drop trigger if exists set_curated_trending_venues_updated_at on public.curated_trending_venues;
create trigger set_curated_trending_venues_updated_at
before update on public.curated_trending_venues
for each row execute function public.set_updated_at();

drop trigger if exists set_venue_now_playing_updated_at on public.venue_now_playing;
create trigger set_venue_now_playing_updated_at
before update on public.venue_now_playing
for each row execute function public.set_updated_at();

drop trigger if exists set_account_deletion_requests_updated_at on public.account_deletion_requests;
create trigger set_account_deletion_requests_updated_at
before update on public.account_deletion_requests
for each row execute function public.set_updated_at();

drop trigger if exists set_identity_deletion_operations_updated_at on public.identity_deletion_operations;
create trigger set_identity_deletion_operations_updated_at
before update on public.identity_deletion_operations
for each row execute function public.set_updated_at();

drop trigger if exists set_data_export_requests_updated_at on public.data_export_requests;
create trigger set_data_export_requests_updated_at
before update on public.data_export_requests
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.submit_venue_signal(
  p_venue_id uuid,
  p_source public.signal_source,
  p_confidence numeric default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_recent_signal_count integer;
  v_venue_exists boolean;
  v_confidence numeric := least(1, greatest(0, coalesce(p_confidence, 1)));
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select exists (
    select 1
    from public.venues
    where id = p_venue_id
      and verification_status in ('needs_verification', 'verified')
  ) into v_venue_exists;

  if not v_venue_exists then
    raise exception 'Venue is not available';
  end if;

  select count(*)
  from (
    select created_at
    from public.venue_pings
    where user_id = v_user_id
      and created_at > now() - interval '2 minutes'
    union all
    select created_at
    from public.manual_checkins
    where user_id = v_user_id
      and created_at > now() - interval '2 minutes'
  ) recent_signals
  into v_recent_signal_count;

  if v_recent_signal_count > 0 then
    return jsonb_build_object('ok', false, 'message', 'Signal cooldown active. Try again in a moment.');
  end if;

  delete from public.venue_pings
  where user_id = v_user_id
    and expires_at > now();

  delete from public.manual_checkins
  where user_id = v_user_id
    and expires_at > now();

  if p_source = 'manual' then
    insert into public.manual_checkins (user_id, venue_id)
    values (v_user_id, p_venue_id);

    return jsonb_build_object('ok', true, 'message', 'Manual placement sent.');
  end if;

  insert into public.venue_pings (user_id, venue_id, source, confidence)
  values (v_user_id, p_venue_id, 'gps', v_confidence);

  return jsonb_build_object('ok', true, 'message', 'GPS signal sent.');
end;
$$;

revoke execute on function public.submit_venue_signal(uuid, public.signal_source, numeric) from public;
grant execute on function public.submit_venue_signal(uuid, public.signal_source, numeric) to authenticated;

-- Music stays useful at low user count: one explicit accepted device report
-- publishes immediately, with bounded text, cooldowns, and retry idempotency.
alter table public.venue_now_playing
add column if not exists origin_report_id uuid;

alter table public.venue_music_observations
add column if not exists origin_report_id uuid;

alter table public.venue_now_playing
drop constraint if exists venue_now_playing_origin_report_id_fkey;

alter table public.venue_now_playing
add constraint venue_now_playing_origin_report_id_fkey
foreign key (origin_report_id)
references public.venue_music_reports (id)
on delete cascade;

alter table public.venue_music_observations
drop constraint if exists venue_music_observations_origin_report_id_fkey;

alter table public.venue_music_observations
add constraint venue_music_observations_origin_report_id_fkey
foreign key (origin_report_id)
references public.venue_music_reports (id)
on delete cascade;

alter table public.venue_music_reports
drop constraint if exists venue_music_reports_title_length_check;

alter table public.venue_music_reports
add constraint venue_music_reports_title_length_check
check (char_length(btrim(track_title)) between 1 and 200)
not valid;

alter table public.venue_music_reports
drop constraint if exists venue_music_reports_artist_length_check;

alter table public.venue_music_reports
add constraint venue_music_reports_artist_length_check
check (artist_name is null or char_length(btrim(artist_name)) <= 200)
not valid;

create index if not exists venue_music_reports_user_venue_created_idx
on public.venue_music_reports (user_id, venue_id, created_at desc)
where user_id is not null;

create or replace function public.submit_device_music_report(
  p_venue_id uuid,
  p_track_title text,
  p_artist_name text default null,
  p_report_source public.now_playing_source default 'user_confirmation'::public.now_playing_source
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_track_title text := btrim(coalesce(p_track_title, ''));
  v_artist_name text := nullif(btrim(coalesce(p_artist_name, '')), '');
  v_report_source public.now_playing_source := coalesce(p_report_source, 'user_confirmation'::public.now_playing_source);
  v_observed_at timestamptz := now();
  v_report_id uuid;
  v_existing_report_id uuid;
  v_confidence numeric(4, 3);
begin
  if v_user_id is null then
    raise exception 'A private device session is required';
  end if;

  if v_report_source not in ('user_audio_match'::public.now_playing_source, 'user_confirmation'::public.now_playing_source) then
    raise exception 'Unsupported music report source';
  end if;

  if v_track_title = '' then
    return jsonb_build_object('ok', false, 'message', 'Track title is required.');
  end if;

  if char_length(v_track_title) > 200 then
    return jsonb_build_object('ok', false, 'message', 'Keep track titles under 200 characters.');
  end if;

  if v_artist_name is not null and char_length(v_artist_name) > 200 then
    return jsonb_build_object('ok', false, 'message', 'Keep artist names under 200 characters.');
  end if;

  if not exists (
    select 1
    from public.venues
    where id = p_venue_id
      and verification_status in ('needs_verification', 'verified')
  ) then
    raise exception 'Venue is not available';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('venue-music:' || v_user_id::text, 0)
  );

  select reports.id
  into v_existing_report_id
  from public.venue_music_reports reports
  where reports.user_id = v_user_id
    and reports.venue_id = p_venue_id
    and reports.report_source = v_report_source
    and lower(btrim(reports.track_title)) = lower(v_track_title)
    and coalesce(lower(btrim(reports.artist_name)), '') = coalesce(lower(v_artist_name), '')
    and reports.created_at > now() - interval '2 minutes'
  order by reports.created_at desc
  limit 1;

  if v_existing_report_id is not null then
    return jsonb_build_object(
      'ok', true,
      'message', 'Now-playing signal was already shared.',
      'report_id', v_existing_report_id,
      'idempotent', true
    );
  end if;

  if v_report_source = 'user_confirmation'::public.now_playing_source
    and not exists (
      select 1
      from public.venue_now_playing current_track
      where current_track.venue_id = p_venue_id
        and current_track.expires_at > now()
        and lower(btrim(current_track.track_title)) = lower(v_track_title)
        and coalesce(lower(btrim(current_track.artist_name)), '') = coalesce(lower(v_artist_name), '')
    ) then
    return jsonb_build_object('ok', false, 'message', 'Only the current displayed track can be confirmed. Use Identify and share for a new song.');
  end if;

  if v_report_source = 'user_audio_match'::public.now_playing_source
    and not exists (
      select 1
      from public.music_recognition_attempts attempts
      where attempts.user_id = v_user_id
        and attempts.venue_id = p_venue_id
        and attempts.created_at > now() - interval '2 minutes'
    ) then
    return jsonb_build_object('ok', false, 'message', 'Start a fresh venue-specific music check before sharing an audio match.');
  end if;

  if exists (
    select 1
    from public.venue_music_reports
    where user_id = v_user_id
      and created_at > now() - interval '1 minute'
  ) then
    return jsonb_build_object('ok', false, 'message', 'Music-sharing cooldown active. Try again in a moment.');
  end if;

  v_confidence := 0.75;

  insert into public.venue_music_reports (
    user_id,
    venue_id,
    track_title,
    artist_name,
    report_source
  )
  values (
    v_user_id,
    p_venue_id,
    v_track_title,
    v_artist_name,
    v_report_source
  )
  returning id into v_report_id;

  insert into public.venue_now_playing (
    venue_id,
    track_title,
    artist_name,
    album_name,
    spotify_track_id,
    source,
    confidence,
    observed_at,
    expires_at,
    updated_at,
    origin_report_id
  )
  values (
    p_venue_id,
    v_track_title,
    v_artist_name,
    null,
    null,
    v_report_source,
    v_confidence,
    v_observed_at,
    v_observed_at + interval '45 minutes',
    v_observed_at,
    v_report_id
  )
  on conflict (venue_id) do update
  set track_title = excluded.track_title,
      artist_name = excluded.artist_name,
      album_name = excluded.album_name,
      spotify_track_id = excluded.spotify_track_id,
      source = excluded.source,
      confidence = excluded.confidence,
      observed_at = excluded.observed_at,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at,
      origin_report_id = excluded.origin_report_id
  where public.venue_now_playing.observed_at <= excluded.observed_at;

  insert into public.venue_music_observations (
    venue_id,
    track_title,
    artist_name,
    source,
    confidence,
    observed_at,
    origin_report_id
  )
  values (
    p_venue_id,
    v_track_title,
    v_artist_name,
    v_report_source,
    v_confidence,
    v_observed_at,
    v_report_id
  );

  return jsonb_build_object(
    'ok', true,
    'message', 'Now-playing signal shared for this venue.',
    'report_id', v_report_id,
    'idempotent', false
  );
end;
$$;

revoke execute on function public.submit_device_music_report(uuid, text, text, public.now_playing_source) from public;

drop policy if exists "venue_music_reports_insert_own" on public.venue_music_reports;

-- Auth deletion now removes attributable device contributions instead of
-- leaving rows with a null owner.
alter table public.venue_reports
drop constraint if exists venue_reports_user_id_fkey;

alter table public.venue_reports
add constraint venue_reports_user_id_fkey
foreign key (user_id)
references auth.users (id)
on delete cascade;

alter table public.venue_reviews
drop constraint if exists venue_reviews_user_id_fkey;

alter table public.venue_reviews
add constraint venue_reviews_user_id_fkey
foreign key (user_id)
references auth.users (id)
on delete cascade;

alter table public.venue_music_reports
drop constraint if exists venue_music_reports_user_id_fkey;

alter table public.venue_music_reports
add constraint venue_music_reports_user_id_fkey
foreign key (user_id)
references auth.users (id)
on delete cascade;

-- Public clients can read broad crowd output but not exact contributing-device
-- counts or private music provenance.
revoke select on table public.crowd_snapshots from public, anon, authenticated;
grant select (
  id,
  venue_id,
  crowd_level,
  has_signal,
  window_start,
  window_end,
  created_at
) on table public.crowd_snapshots to anon, authenticated;

revoke all on table public.venue_now_playing from public, anon, authenticated;
grant select (
  venue_id,
  track_title,
  artist_name,
  album_name,
  spotify_track_id,
  source,
  confidence,
  observed_at,
  expires_at,
  updated_at
) on table public.venue_now_playing to anon, authenticated;

revoke select on table public.venue_music_observations from public, anon, authenticated;
grant select (
  id,
  venue_id,
  track_title,
  artist_name,
  genre,
  source,
  confidence,
  observed_at,
  spotify_track_id,
  created_at
) on table public.venue_music_observations to anon, authenticated;

-- Anonymous consumer sessions can never become launch administrators.
delete from public.app_admins admins
using auth.users users
where admins.user_id = users.id
  and users.is_anonymous is true;

create or replace function public.reject_anonymous_app_admin()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1
    from auth.users
    where id = new.user_id
      and is_anonymous is true
  ) then
    raise exception 'Anonymous users cannot be app administrators';
  end if;

  return new;
end;
$$;

revoke execute on function public.reject_anonymous_app_admin() from public;

drop trigger if exists reject_anonymous_app_admin on public.app_admins;
create trigger reject_anonymous_app_admin
before insert or update on public.app_admins
for each row execute function public.reject_anonymous_app_admin();

create or replace function public.get_admin_status()
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null
    and not public.current_user_is_anonymous()
    and exists (
      select 1
      from public.app_admins
      where user_id = auth.uid()
    );
$$;

revoke execute on function public.get_admin_status() from public;
grant execute on function public.get_admin_status() to authenticated;

drop policy if exists "app_admins_select_own" on public.app_admins;
create policy "app_admins_select_own"
on public.app_admins for select
to authenticated
using (not public.current_user_is_anonymous() and auth.uid() = user_id);

drop policy if exists "admin_venue_signals_select_admin" on public.admin_venue_signals;
create policy "admin_venue_signals_select_admin"
on public.admin_venue_signals for select
to authenticated
using (
  not public.current_user_is_anonymous()
  and exists (select 1 from public.app_admins where user_id = auth.uid())
);

drop policy if exists "curated_trending_venues_select_admin" on public.curated_trending_venues;
create policy "curated_trending_venues_select_admin"
on public.curated_trending_venues for select
to authenticated
using (
  not public.current_user_is_anonymous()
  and exists (select 1 from public.app_admins where user_id = auth.uid())
);

-- Legacy email-oriented request tables remain available only to permanent
-- accounts; anonymous installations use the authenticated deletion function
-- and direct in-app JSON export.
drop policy if exists "account_deletion_requests_select_own" on public.account_deletion_requests;
create policy "account_deletion_requests_select_own"
on public.account_deletion_requests for select
to authenticated
using (not public.current_user_is_anonymous() and auth.uid() = user_id);

drop policy if exists "account_deletion_requests_insert_own" on public.account_deletion_requests;
create policy "account_deletion_requests_insert_own"
on public.account_deletion_requests for insert
to authenticated
with check (not public.current_user_is_anonymous() and auth.uid() = user_id and status = 'requested');

drop policy if exists "account_deletion_requests_cancel_own" on public.account_deletion_requests;
create policy "account_deletion_requests_cancel_own"
on public.account_deletion_requests for update
to authenticated
using (not public.current_user_is_anonymous() and auth.uid() = user_id and status = 'requested')
with check (not public.current_user_is_anonymous() and auth.uid() = user_id and status = 'cancelled');

-- Legacy-positioned launch wrappers. The generated setup reapplies the final
-- wrappers from launch_hardening_final.sql after every cumulative definition.
-- These declarations make this legacy-positioned block parse safely. The
-- generated setup applies launch_hardening_final.sql after the full schema.
create table if not exists public.launch_runtime_controls (
  singleton boolean primary key default true check (singleton),
  crowd_writes_enabled boolean not null default true,
  ratings_enabled boolean not null default true,
  written_reviews_enabled boolean not null default true,
  venue_reports_enabled boolean not null default true,
  music_sharing_enabled boolean not null default true,
  audio_recognition_enabled boolean not null default true,
  maintenance_message text check (maintenance_message is null or char_length(maintenance_message) <= 240),
  updated_at timestamptz not null default now()
);

create table if not exists public.launch_rate_buckets (
  action_name text not null,
  target_key text not null,
  bucket_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (action_name, target_key, bucket_start)
);

set check_function_bodies = off;
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

-- Public music reads expose current metadata and ranked broad periods only.
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

-- Reassert retired request queues and private launch-control tables after all
-- legacy policy definitions above.
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

drop policy if exists "data_export_requests_select_own" on public.data_export_requests;
create policy "data_export_requests_select_own"
on public.data_export_requests for select
to authenticated
using (not public.current_user_is_anonymous() and auth.uid() = user_id);

drop policy if exists "data_export_requests_insert_own" on public.data_export_requests;
create policy "data_export_requests_insert_own"
on public.data_export_requests for insert
to authenticated
with check (not public.current_user_is_anonymous() and auth.uid() = user_id and status = 'requested');

drop policy if exists "data_export_requests_cancel_own" on public.data_export_requests;
create policy "data_export_requests_cancel_own"
on public.data_export_requests for update
to authenticated
using (not public.current_user_is_anonymous() and auth.uid() = user_id and status = 'requested')
with check (not public.current_user_is_anonymous() and auth.uid() = user_id and status = 'cancelled');

-- Launch hardening: server-enforced kill switches and UID-independent budgets.
create table if not exists public.launch_runtime_controls (
  singleton boolean primary key default true check (singleton),
  crowd_writes_enabled boolean not null default true,
  ratings_enabled boolean not null default true,
  written_reviews_enabled boolean not null default true,
  venue_reports_enabled boolean not null default true,
  music_sharing_enabled boolean not null default true,
  audio_recognition_enabled boolean not null default true,
  maintenance_message text check (maintenance_message is null or char_length(maintenance_message) <= 240),
  updated_at timestamptz not null default now()
);

insert into public.launch_runtime_controls (singleton)
values (true)
on conflict (singleton) do nothing;

alter table public.launch_runtime_controls enable row level security;
revoke all on table public.launch_runtime_controls from public, anon, authenticated;
grant all on table public.launch_runtime_controls to service_role;

create table if not exists public.launch_rate_buckets (
  action_name text not null,
  target_key text not null,
  bucket_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (action_name, target_key, bucket_start)
);

alter table public.launch_rate_buckets enable row level security;
revoke all on table public.launch_rate_buckets from public, anon, authenticated;
grant all on table public.launch_rate_buckets to service_role;
create index if not exists launch_rate_buckets_bucket_start_idx
on public.launch_rate_buckets (bucket_start);

create or replace function public.launch_feature_is_enabled(p_feature text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case p_feature
    when 'crowd_writes' then crowd_writes_enabled
    when 'ratings' then ratings_enabled
    when 'written_reviews' then written_reviews_enabled
    when 'venue_reports' then venue_reports_enabled
    when 'music_sharing' then music_sharing_enabled
    when 'audio_recognition' then audio_recognition_enabled
    else false
  end
  from public.launch_runtime_controls
  where singleton = true;
$$;

revoke execute on function public.launch_feature_is_enabled(text) from public, anon, authenticated;
grant execute on function public.launch_feature_is_enabled(text) to service_role;

create or replace function public.consume_launch_rate_budget(
  p_action_name text,
  p_target_key text,
  p_window_seconds integer,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_bucket_start timestamptz;
  v_count integer;
begin
  if p_window_seconds < 60 or p_window_seconds > 86400 or p_limit < 1 then
    raise exception 'Invalid launch rate budget';
  end if;

  v_bucket_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.launch_rate_buckets (action_name, target_key, bucket_start, request_count)
  values (p_action_name, p_target_key, v_bucket_start, 1)
  on conflict (action_name, target_key, bucket_start) do update
  set request_count = public.launch_rate_buckets.request_count + 1
  where public.launch_rate_buckets.request_count < p_limit
  returning request_count into v_count;

  return v_count is not null;
end;
$$;

revoke execute on function public.consume_launch_rate_budget(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_launch_rate_budget(text, text, integer, integer) to service_role;

create or replace function public.enforce_launch_write_controls()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_allowed boolean;
begin
  if tg_table_name = 'venue_reviews' then
    if not coalesce(public.launch_feature_is_enabled('ratings'), false) then
      raise exception 'Ratings are temporarily paused.';
    end if;

    if new.comment is not null and not coalesce(public.launch_feature_is_enabled('written_reviews'), false) then
      raise exception 'Written reviews are temporarily paused.';
    end if;

    v_allowed := public.consume_launch_rate_budget('ratings', new.venue_id::text, 3600, 10)
      and public.consume_launch_rate_budget('ratings', 'global', 3600, 200);
  elsif tg_table_name = 'venue_reports' then
    if not coalesce(public.launch_feature_is_enabled('venue_reports'), false) then
      raise exception 'Venue reports are temporarily paused.';
    end if;

    v_allowed := public.consume_launch_rate_budget(
        'venue_reports',
        coalesce(new.venue_id::text, 'missing'),
        3600,
        case when new.venue_id is null then 25 else 10 end
      )
      and public.consume_launch_rate_budget('venue_reports', 'global', 3600, 100);
  elsif tg_table_name = 'music_recognition_attempts' then
    if not coalesce(public.launch_feature_is_enabled('audio_recognition'), false) then
      raise exception 'Audio recognition is temporarily paused.';
    end if;

    v_allowed := public.consume_launch_rate_budget('recognition', new.venue_id::text, 600, 6)
      and public.consume_launch_rate_budget('recognition', 'global', 3600, 60);
  elsif tg_table_name = 'venue_music_reports' then
    if not coalesce(public.launch_feature_is_enabled('music_sharing'), false) then
      raise exception 'Music sharing is temporarily paused.';
    end if;

    v_allowed := public.consume_launch_rate_budget('music_reports', new.venue_id::text, 600, 30)
      and public.consume_launch_rate_budget('music_reports', 'global', 3600, 300);
  else
    raise exception 'Unsupported launch-controlled table';
  end if;

  if not v_allowed then
    raise exception 'This contribution type is temporarily rate limited.';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_launch_write_controls() from public, anon, authenticated;

drop trigger if exists enforce_launch_review_controls on public.venue_reviews;
create trigger enforce_launch_review_controls
before insert or update of rating, comment on public.venue_reviews
for each row execute function public.enforce_launch_write_controls();

drop trigger if exists enforce_launch_venue_report_controls on public.venue_reports;
create trigger enforce_launch_venue_report_controls
before insert on public.venue_reports
for each row execute function public.enforce_launch_write_controls();

drop trigger if exists enforce_launch_recognition_controls on public.music_recognition_attempts;
create trigger enforce_launch_recognition_controls
before insert on public.music_recognition_attempts
for each row execute function public.enforce_launch_write_controls();

drop trigger if exists enforce_launch_music_report_controls on public.venue_music_reports;
create trigger enforce_launch_music_report_controls
before insert on public.venue_music_reports
for each row execute function public.enforce_launch_write_controls();

create or replace function public.cleanup_launch_rate_buckets()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_deleted integer;
begin
  delete from public.launch_rate_buckets
  where bucket_start < now() - interval '2 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.cleanup_launch_rate_buckets() from public, anon, authenticated;
grant execute on function public.cleanup_launch_rate_buckets() to service_role;

-- Store at most one public crowd state per venue and 15-minute bucket. Exact
-- reconciliation still runs every two minutes, but bursts no longer append a
-- snapshot or rescan every active contributor for each arriving user.
alter table public.crowd_snapshots
add column if not exists snapshot_bucket timestamptz;

update public.crowd_snapshots
set snapshot_bucket = pg_catalog.date_bin(
      interval '15 minutes',
      created_at,
      '2000-01-01 00:00:00+00'::timestamptz
    ),
    created_at = pg_catalog.date_bin(
      interval '15 minutes',
      created_at,
      '2000-01-01 00:00:00+00'::timestamptz
    ),
    window_start = pg_catalog.date_bin(
      interval '15 minutes',
      window_end,
      '2000-01-01 00:00:00+00'::timestamptz
    ) - (window_end - window_start),
    window_end = pg_catalog.date_bin(
      interval '15 minutes',
      window_end,
      '2000-01-01 00:00:00+00'::timestamptz
    )
where snapshot_bucket is null
   or created_at <> pg_catalog.date_bin(
        interval '15 minutes',
        created_at,
        '2000-01-01 00:00:00+00'::timestamptz
      );

with ranked as (
  select id, row_number() over (
    partition by venue_id, snapshot_bucket
    order by created_at desc, id desc
  ) as duplicate_rank
  from public.crowd_snapshots
)
delete from public.crowd_snapshots snapshots
using ranked
where snapshots.id = ranked.id
  and ranked.duplicate_rank > 1;

alter table public.crowd_snapshots
alter column snapshot_bucket set not null,
alter column snapshot_bucket set default pg_catalog.date_bin(
  interval '15 minutes',
  now(),
  '2000-01-01 00:00:00+00'::timestamptz
);

create unique index if not exists crowd_snapshots_venue_bucket_uidx
on public.crowd_snapshots (venue_id, snapshot_bucket);

create index if not exists manual_checkins_venue_created_idx
on public.manual_checkins (venue_id, created_at desc);
create index if not exists venue_pings_venue_user_expires_idx
on public.venue_pings (venue_id, user_id, expires_at desc);
create index if not exists manual_checkins_venue_user_expires_idx
on public.manual_checkins (venue_id, user_id, expires_at desc);
create index if not exists venue_pings_expires_idx on public.venue_pings (expires_at);
create index if not exists manual_checkins_expires_idx on public.manual_checkins (expires_at);
create index if not exists crowd_snapshots_window_end_idx on public.crowd_snapshots (window_end);
create index if not exists admin_venue_signals_expires_idx on public.admin_venue_signals (expires_at);
create index if not exists curated_trending_venues_expires_idx on public.curated_trending_venues (expires_at);
create index if not exists venue_music_observations_observed_at_idx on public.venue_music_observations (observed_at);
create index if not exists venue_music_reports_created_at_idx on public.venue_music_reports (created_at);
create index if not exists music_recognition_attempts_created_at_idx on public.music_recognition_attempts (created_at);
create index if not exists identity_deletion_operations_completed_at_idx
on public.identity_deletion_operations (completed_at) where status = 'completed';

create or replace function public.launch_refresh_crowd_snapshots(p_window_minutes integer default 90)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_window_minutes integer := least(240, greatest(15, coalesce(p_window_minutes, 90)));
  v_window_start timestamptz := now() - make_interval(mins => least(240, greatest(15, coalesce(p_window_minutes, 90))));
  v_window_end timestamptz := now();
  v_bucket timestamptz := pg_catalog.date_bin(interval '15 minutes', now(), '2000-01-01 00:00:00+00'::timestamptz);
  v_inserted integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('crowd-refresh-all', 0)
  );

  with community_signals as (
    select venue_id, user_id
    from public.venue_pings
    where created_at >= v_window_start and expires_at > v_window_end
    union
    select venue_id, user_id
    from public.manual_checkins
    where created_at >= v_window_start and expires_at > v_window_end
  ),
  community_counts as (
    select venue_id, count(*)::integer as sample_size
    from community_signals
    group by venue_id
  ),
  admin_scores as (
    select venue_id, max(signal_score) as signal_score, count(*)::integer as sample_size
    from public.admin_venue_signals
    where created_at <= v_window_end and expires_at > v_window_end
    group by venue_id
  ),
  venue_scores as (
    select
      venues.id as venue_id,
      coalesce(community_counts.sample_size, 0) as community_sample_size,
      coalesce(admin_scores.sample_size, 0) as admin_sample_size,
      greatest(
        case when coalesce(community_counts.sample_size, 0) >= 2 then 0.3 else 0 end,
        coalesce(admin_scores.signal_score, 0)
      ) as signal_score
    from public.venues venues
    left join community_counts on community_counts.venue_id = venues.id
    left join admin_scores on admin_scores.venue_id = venues.id
    where venues.verification_status in ('needs_verification', 'verified')
  ),
  inserted as (
    insert into public.crowd_snapshots (
      venue_id, crowd_level, has_signal, signal_score, sample_size,
      window_start, window_end, created_at, snapshot_bucket
    )
    select
      venue_id,
      case
        when signal_score >= 0.78 then 'packed'::public.crowd_level
        when signal_score >= 0.55 then 'busy'::public.crowd_level
        when signal_score >= 0.28 then 'active'::public.crowd_level
        else 'quiet'::public.crowd_level
      end,
      community_sample_size >= 2 or admin_sample_size > 0,
      round(signal_score::numeric, 4),
      community_sample_size + admin_sample_size,
      v_bucket - make_interval(mins => v_window_minutes),
      v_bucket,
      v_bucket,
      v_bucket
    from venue_scores
    on conflict (venue_id, snapshot_bucket) do update
    set crowd_level = excluded.crowd_level,
        has_signal = excluded.has_signal,
        signal_score = excluded.signal_score,
        sample_size = excluded.sample_size,
        window_start = excluded.window_start,
        window_end = excluded.window_end,
        created_at = excluded.created_at
    returning 1
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end;
$$;

revoke execute on function public.launch_refresh_crowd_snapshots(integer) from public, anon, authenticated;
grant execute on function public.launch_refresh_crowd_snapshots(integer) to service_role;

create or replace function public.launch_refresh_venue_crowd_snapshot(
  p_venue_id uuid,
  p_window_minutes integer default 90
)
returns public.crowd_level
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_window_minutes integer := least(240, greatest(15, coalesce(p_window_minutes, 90)));
  v_window_end timestamptz := now();
  v_window_start timestamptz := now() - make_interval(mins => least(240, greatest(15, coalesce(p_window_minutes, 90))));
  v_bucket timestamptz := pg_catalog.date_bin(interval '15 minutes', now(), '2000-01-01 00:00:00+00'::timestamptz);
  v_community_count integer := 0;
  v_admin_count integer := 0;
  v_admin_score numeric := 0;
  v_score numeric;
  v_level public.crowd_level;
begin
  if not exists (
    select 1 from public.venues
    where id = p_venue_id and verification_status in ('needs_verification', 'verified')
  ) then
    raise exception 'Venue is not available';
  end if;

  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('crowd-refresh-all', 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('crowd-venue:' || p_venue_id::text, 0)
  );

  select count(*)::integer
  into v_community_count
  from (
    select user_id from public.venue_pings
    where venue_id = p_venue_id and created_at >= v_window_start and expires_at > v_window_end
    union
    select user_id from public.manual_checkins
    where venue_id = p_venue_id and created_at >= v_window_start and expires_at > v_window_end
  ) signals;

  select count(*)::integer, coalesce(max(signal_score), 0)
  into v_admin_count, v_admin_score
  from public.admin_venue_signals
  where venue_id = p_venue_id and created_at <= v_window_end and expires_at > v_window_end;

  v_score := greatest(case when v_community_count >= 2 then 0.3 else 0 end, v_admin_score);
  v_level := case
    when v_score >= 0.78 then 'packed'::public.crowd_level
    when v_score >= 0.55 then 'busy'::public.crowd_level
    when v_score >= 0.28 then 'active'::public.crowd_level
    else 'quiet'::public.crowd_level
  end;

  insert into public.crowd_snapshots (
    venue_id, crowd_level, has_signal, signal_score, sample_size,
    window_start, window_end, created_at, snapshot_bucket
  )
  values (
    p_venue_id, v_level, v_community_count >= 2 or v_admin_count > 0,
    round(v_score::numeric, 4), v_community_count + v_admin_count,
    v_bucket - make_interval(mins => v_window_minutes), v_bucket, v_bucket, v_bucket
  )
  on conflict (venue_id, snapshot_bucket) do update
  set crowd_level = excluded.crowd_level,
      has_signal = excluded.has_signal,
      signal_score = excluded.signal_score,
      sample_size = excluded.sample_size,
      window_start = excluded.window_start,
      window_end = excluded.window_end,
      created_at = excluded.created_at;

  return v_level;
end;
$$;

revoke execute on function public.launch_refresh_venue_crowd_snapshot(uuid, integer) from public, anon, authenticated;
grant execute on function public.launch_refresh_venue_crowd_snapshot(uuid, integer) to service_role;

create or replace function public.publish_venue_crowd_floor(p_venue_id uuid)
returns public.crowd_level
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_bucket timestamptz := pg_catalog.date_bin(interval '15 minutes', now(), '2000-01-01 00:00:00+00'::timestamptz);
  v_level public.crowd_level;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('crowd-venue:' || p_venue_id::text, 0)
  );

  insert into public.crowd_snapshots (
    venue_id, crowd_level, has_signal, signal_score, sample_size,
    window_start, window_end, created_at, snapshot_bucket
  )
  values (
    p_venue_id, 'active', true, 0.3, 2,
    v_bucket - interval '90 minutes', v_bucket, v_bucket, v_bucket
  )
  on conflict (venue_id, snapshot_bucket) do update
  set crowd_level = case
        when public.crowd_snapshots.signal_score >= 0.78 then 'packed'::public.crowd_level
        when public.crowd_snapshots.signal_score >= 0.55 then 'busy'::public.crowd_level
        else 'active'::public.crowd_level
      end,
      has_signal = true,
      signal_score = greatest(public.crowd_snapshots.signal_score, 0.3),
      sample_size = greatest(public.crowd_snapshots.sample_size, 2),
      window_start = excluded.window_start,
      window_end = excluded.window_end,
      created_at = excluded.created_at
  returning crowd_level into v_level;

  return v_level;
end;
$$;

revoke execute on function public.publish_venue_crowd_floor(uuid) from public, anon, authenticated;

create or replace function public.launch_submit_venue_signal(
  p_venue_id uuid,
  p_source public.signal_source,
  p_confidence numeric default 1
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_recent_signal_count integer;
  v_confidence numeric;
  v_crowd_level public.crowd_level := 'quiet';
  v_has_public_signal boolean := false;
  v_has_quorum boolean := false;
begin
  if v_user_id is null then
    raise exception 'A private device session is required';
  end if;

  if not coalesce(public.launch_feature_is_enabled('crowd_writes'), false) then
    return jsonb_build_object('ok', false, 'message', 'Crowd sharing is temporarily paused.');
  end if;

  if p_source is null or p_source not in ('gps'::public.signal_source, 'manual'::public.signal_source) then
    return jsonb_build_object('ok', false, 'message', 'Unsupported crowd signal source.');
  end if;

  if p_confidence is not null and (
    p_confidence::text = 'NaN' or p_confidence < 0 or p_confidence > 1
  ) then
    return jsonb_build_object('ok', false, 'message', 'Signal confidence must be between 0 and 1.');
  end if;

  v_confidence := coalesce(p_confidence, 1);

  if not exists (
    select 1 from public.venues
    where id = p_venue_id and verification_status in ('needs_verification', 'verified')
  ) then
    raise exception 'Venue is not available';
  end if;

  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('crowd-refresh-all', 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('venue-signal:' || v_user_id::text, 0)
  );

  if (
    p_source = 'gps'::public.signal_source
    and exists (
      select 1 from public.venue_pings
      where user_id = v_user_id and venue_id = p_venue_id
        and created_at > now() - interval '2 minutes' and expires_at > now()
    )
  ) or (
    p_source = 'manual'::public.signal_source
    and exists (
      select 1 from public.manual_checkins
      where user_id = v_user_id and venue_id = p_venue_id
        and created_at > now() - interval '2 minutes' and expires_at > now()
    )
  ) then
    select crowd_level, has_signal
    into v_crowd_level, v_has_public_signal
    from public.crowd_snapshots
    where venue_id = p_venue_id
    order by created_at desc, id desc
    limit 1;

    return jsonb_build_object(
      'ok', true,
      'message', 'Venue signal was already shared.',
      'crowd_level', coalesce(v_crowd_level, 'quiet'::public.crowd_level),
      'has_signal', coalesce(v_has_public_signal, false),
      'idempotent', true
    );
  end if;

  select count(*) into v_recent_signal_count
  from (
    select created_at from public.venue_pings
    where user_id = v_user_id and created_at > now() - interval '2 minutes'
    union all
    select created_at from public.manual_checkins
    where user_id = v_user_id and created_at > now() - interval '2 minutes'
  ) recent_signals;

  if v_recent_signal_count > 0 then
    return jsonb_build_object('ok', false, 'message', 'Signal cooldown active. Try again in a moment.');
  end if;

  if not public.consume_launch_rate_budget('crowd_signals', p_venue_id::text, 600, 30)
    or not public.consume_launch_rate_budget('crowd_signals', 'global', 600, 500) then
    return jsonb_build_object('ok', false, 'message', 'Crowd sharing is temporarily limited for launch safety.');
  end if;

  delete from public.venue_pings where user_id = v_user_id and expires_at > now();
  delete from public.manual_checkins where user_id = v_user_id and expires_at > now();

  if p_source = 'manual'::public.signal_source then
    insert into public.manual_checkins (user_id, venue_id) values (v_user_id, p_venue_id);
  else
    insert into public.venue_pings (user_id, venue_id, source, confidence)
    values (v_user_id, p_venue_id, 'gps'::public.signal_source, v_confidence);
  end if;

  v_has_quorum := exists (
      select 1 from public.venue_pings
      where venue_id = p_venue_id and user_id <> v_user_id and expires_at > now()
    ) or exists (
      select 1 from public.manual_checkins
      where venue_id = p_venue_id and user_id <> v_user_id and expires_at > now()
    );

  if v_has_quorum then
    v_crowd_level := public.publish_venue_crowd_floor(p_venue_id);
    v_has_public_signal := true;
  else
    select crowd_level, has_signal
    into v_crowd_level, v_has_public_signal
    from public.crowd_snapshots
    where venue_id = p_venue_id
    order by created_at desc, id desc
    limit 1;
  end if;

  return jsonb_build_object(
    'ok', true,
    'message', case
      when v_has_quorum then 'Signal shared. Recent community activity is now visible.'
      else 'Signal shared privately. Another recent signal is needed before community activity appears.'
    end,
    'crowd_level', coalesce(v_crowd_level, 'quiet'::public.crowd_level),
    'has_signal', coalesce(v_has_public_signal, false)
  );
end;
$$;

revoke execute on function public.launch_submit_venue_signal(uuid, public.signal_source, numeric) from public, anon, authenticated;

-- Public ratings require a durable account and a minimum sample. Account-free
-- number ratings remain owner-visible private feedback and cannot Sybil-shift
-- Best rankings during launch.
create or replace function public.launch_get_venue_review_summaries()
returns table (venue_id uuid, average_rating numeric, review_count integer)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    reviews.venue_id,
    round(avg(reviews.rating)::numeric, 1),
    count(*)::integer
  from public.venue_reviews reviews
  join auth.users users on users.id = reviews.user_id
  where reviews.hidden_at is null
    and not coalesce(users.is_anonymous, false)
    and (reviews.comment is null or reviews.moderation_status = 'approved')
  group by reviews.venue_id
  having count(*) >= 3;
$$;

revoke execute on function public.launch_get_venue_review_summaries() from public, anon, authenticated;

create or replace function public.launch_get_public_venue_reviews(
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
  select
    reviews.id,
    reviews.venue_id,
    reviews.rating,
    case when reviews.moderation_status = 'approved' or reviews.user_id = auth.uid() then reviews.comment else null end,
    reviews.updated_at,
    case
      when reviews.user_id = auth.uid() then reviews.moderation_status
      when reviews.moderation_status = 'approved' then 'approved'
      else null
    end,
    coalesce(reviews.user_id = auth.uid(), false)
  from public.venue_reviews reviews
  where reviews.venue_id = p_venue_id
    and reviews.hidden_at is null
    and (
      reviews.user_id = auth.uid()
      or (reviews.comment is not null and reviews.moderation_status = 'approved')
    )
    and not exists (
      select 1 from public.review_user_blocks blocks
      where blocks.blocker_user_id = auth.uid()
        and blocks.blocked_user_id = reviews.user_id
    )
  order by coalesce(reviews.user_id = auth.uid(), false) desc, reviews.updated_at desc
  limit least(50, greatest(1, coalesce(p_limit, 20)));
$$;

revoke execute on function public.launch_get_public_venue_reviews(uuid, integer) from public, anon, authenticated;

-- Provider matches may only be published by the trusted Android Edge
-- Function. Client assertions and iOS local matches cannot write public music.
alter table public.music_recognition_attempts
add column if not exists consumed_at timestamptz;

create or replace function public.launch_claim_music_recognition_attempt(p_venue_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_recent_count integer;
  v_attempt_id uuid;
begin
  if v_user_id is null then
    raise exception 'A private device session is required';
  end if;

  if not coalesce(public.launch_feature_is_enabled('audio_recognition'), false) then
    return jsonb_build_object('ok', false, 'message', 'Audio recognition is temporarily paused.');
  end if;

  if not exists (
    select 1 from public.venues
    where id = p_venue_id and verification_status in ('needs_verification', 'verified')
  ) then
    raise exception 'Venue is not available';
  end if;

  if not (
    exists (
      select 1 from public.venue_pings
      where user_id = v_user_id and venue_id = p_venue_id and expires_at > now()
    )
    or exists (
      select 1 from public.manual_checkins
      where user_id = v_user_id and venue_id = p_venue_id and expires_at > now()
    )
  ) then
    return jsonb_build_object('ok', false, 'message', 'Share a current venue placement before starting music recognition.');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('music-recognition:' || v_user_id::text, 0)
  );

  if exists (
    select 1 from public.music_recognition_attempts
    where user_id = v_user_id and created_at > now() - interval '1 minute'
  ) then
    return jsonb_build_object('ok', false, 'message', 'Music recognition cooldown active. Try again in a moment.');
  end if;

  select count(*) into v_recent_count
  from public.music_recognition_attempts
  where user_id = v_user_id and created_at > now() - interval '1 hour';

  if v_recent_count >= 3 then
    return jsonb_build_object('ok', false, 'message', 'Music recognition limit reached for this hour.');
  end if;

  insert into public.music_recognition_attempts (user_id, venue_id)
  values (v_user_id, p_venue_id)
  returning id into v_attempt_id;

  return jsonb_build_object(
    'ok', true,
    'message', 'Music recognition attempt accepted.',
    'attempt_id', v_attempt_id
  );
end;
$$;

revoke execute on function public.launch_claim_music_recognition_attempt(uuid) from public, anon, authenticated;

create or replace function public.publish_provider_music_match(
  p_attempt_id uuid,
  p_user_id uuid,
  p_venue_id uuid,
  p_track_title text,
  p_artist_name text default null,
  p_confidence numeric default 0.75
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_title text := btrim(coalesce(p_track_title, ''));
  v_artist text := nullif(btrim(coalesce(p_artist_name, '')), '');
  v_confidence numeric := least(1, greatest(0, coalesce(p_confidence, 0.75)));
  v_report_id uuid;
  v_now timestamptz := now();
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  if not coalesce(public.launch_feature_is_enabled('music_sharing'), false) then
    return jsonb_build_object('ok', false, 'message', 'Music sharing is temporarily paused.');
  end if;

  if v_title = '' or char_length(v_title) > 200
    or (v_artist is not null and char_length(v_artist) > 200) then
    return jsonb_build_object('ok', false, 'message', 'Invalid provider track metadata.');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('provider-music:' || p_attempt_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('trusted-venue-music:' || p_venue_id::text, 0)
  );

  if not (
    exists (
      select 1 from public.venue_pings
      where user_id = p_user_id and venue_id = p_venue_id and expires_at > v_now
    )
    or exists (
      select 1 from public.manual_checkins
      where user_id = p_user_id and venue_id = p_venue_id and expires_at > v_now
    )
  ) then
    return jsonb_build_object('ok', false, 'message', 'A current venue signal is required before publishing a provider match.');
  end if;

  update public.music_recognition_attempts
  set consumed_at = v_now
  where id = p_attempt_id
    and user_id = p_user_id
    and venue_id = p_venue_id
    and consumed_at is null
    and created_at > v_now - interval '2 minutes';

  if not found then
    return jsonb_build_object('ok', false, 'message', 'Recognition attempt is missing, expired, or already used.');
  end if;

  insert into public.venue_music_reports (
    user_id, venue_id, track_title, artist_name, report_source
  )
  values (p_user_id, p_venue_id, v_title, v_artist, 'user_audio_match')
  returning id into v_report_id;

  insert into public.venue_now_playing (
    venue_id, track_title, artist_name, source, confidence,
    observed_at, expires_at, updated_at, origin_report_id
  )
  values (
    p_venue_id, v_title, v_artist, 'user_audio_match', v_confidence,
    v_now, v_now + interval '45 minutes', v_now, v_report_id
  )
  on conflict (venue_id) do update
  set track_title = excluded.track_title,
      artist_name = excluded.artist_name,
      source = excluded.source,
      confidence = excluded.confidence,
      observed_at = excluded.observed_at,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at,
      origin_report_id = excluded.origin_report_id
  where public.venue_now_playing.observed_at <= excluded.observed_at;

  insert into public.venue_music_observations (
    venue_id, track_title, artist_name, source, confidence, observed_at, origin_report_id
  )
  values (
    p_venue_id, v_title, v_artist, 'user_audio_match', v_confidence, v_now, v_report_id
  );

  return jsonb_build_object('ok', true, 'message', 'Trusted provider match published.', 'report_id', v_report_id);
end;
$$;

revoke execute on function public.publish_provider_music_match(uuid, uuid, uuid, text, text, numeric) from public, anon, authenticated;
grant execute on function public.publish_provider_music_match(uuid, uuid, uuid, text, text, numeric) to service_role;

create or replace function public.launch_submit_venue_music_report(
  p_venue_id uuid,
  p_track_title text,
  p_artist_name text default null,
  p_report_source public.now_playing_source default 'user_confirmation'::public.now_playing_source
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_title text := btrim(coalesce(p_track_title, ''));
  v_artist text := nullif(btrim(coalesce(p_artist_name, '')), '');
  v_report_id uuid;
begin
  if v_user_id is null then
    raise exception 'A private device session is required';
  end if;

  if p_report_source <> 'user_confirmation'::public.now_playing_source then
    return jsonb_build_object('ok', false, 'message', 'Client-provided audio matches cannot be published.');
  end if;

  if not coalesce(public.launch_feature_is_enabled('music_sharing'), false) then
    return jsonb_build_object('ok', false, 'message', 'Music sharing is temporarily paused.');
  end if;

  if v_title = '' or char_length(v_title) > 200
    or (v_artist is not null and char_length(v_artist) > 200) then
    return jsonb_build_object('ok', false, 'message', 'Invalid track metadata.');
  end if;

  if not exists (
    select 1 from public.venue_now_playing current_track
    where current_track.venue_id = p_venue_id
      and current_track.expires_at > now()
      and lower(btrim(current_track.track_title)) = lower(v_title)
      and coalesce(lower(btrim(current_track.artist_name)), '') = coalesce(lower(v_artist), '')
  ) then
    return jsonb_build_object('ok', false, 'message', 'Only the current displayed track can be confirmed.');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('venue-music:' || v_user_id::text, 0)
  );

  select id into v_report_id
  from public.venue_music_reports
  where user_id = v_user_id
    and venue_id = p_venue_id
    and report_source = 'user_confirmation'
    and lower(btrim(track_title)) = lower(v_title)
    and coalesce(lower(btrim(artist_name)), '') = coalesce(lower(v_artist), '')
    and created_at > now() - interval '45 minutes'
  order by created_at desc
  limit 1;

  if v_report_id is not null then
    return jsonb_build_object(
      'ok', true,
      'message', 'Track confirmation was already saved privately.',
      'report_id', v_report_id,
      'idempotent', true
    );
  end if;

  insert into public.venue_music_reports (
    user_id, venue_id, track_title, artist_name, report_source
  )
  values (v_user_id, p_venue_id, v_title, v_artist, 'user_confirmation')
  returning id into v_report_id;

  return jsonb_build_object(
    'ok', true,
    'message', 'Track confirmation saved privately.',
    'report_id', v_report_id,
    'idempotent', false
  );
end;
$$;

revoke execute on function public.launch_submit_venue_music_report(uuid, text, text, public.now_playing_source) from public, anon, authenticated;

create or replace function public.launch_submit_music_match_feedback(
  p_venue_id uuid,
  p_track_title text,
  p_artist_name text,
  p_is_correct boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_title text := btrim(coalesce(p_track_title, ''));
  v_artist text := nullif(btrim(coalesce(p_artist_name, '')), '');
  v_report_id uuid;
begin
  if v_user_id is null then
    raise exception 'A private device session is required';
  end if;

  if p_is_correct is null or v_title = '' or char_length(v_title) > 200
    or (v_artist is not null and char_length(v_artist) > 200) then
    return jsonb_build_object('ok', false, 'message', 'Invalid venue and song feedback.');
  end if;

  if not exists (
    select 1 from public.venues
    where id = p_venue_id
      and verification_status in ('needs_verification', 'verified')
  ) then
    raise exception 'Venue is not available';
  end if;

  if not (
    exists (
      select 1 from public.venue_pings
      where user_id = v_user_id and venue_id = p_venue_id and expires_at > now()
    )
    or exists (
      select 1 from public.manual_checkins
      where user_id = v_user_id and venue_id = p_venue_id and expires_at > now()
    )
  ) then
    return jsonb_build_object('ok', false, 'message', 'Confirm your current venue before sending song feedback.');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('music-feedback:' || v_user_id::text, 0)
  );

  select reports.id into v_report_id
  from public.venue_music_reports reports
  where reports.user_id = v_user_id
    and reports.venue_id = p_venue_id
    and lower(btrim(reports.track_title)) = lower(v_title)
    and coalesce(lower(btrim(reports.artist_name)), '') = coalesce(lower(v_artist), '')
    and reports.feedback_is_correct is not distinct from p_is_correct
    and reports.created_at > now() - interval '2 minutes'
  order by reports.created_at desc
  limit 1;

  if v_report_id is not null then
    return jsonb_build_object(
      'ok', true,
      'message', 'This accuracy feedback was already saved. Thank you.',
      'report_id', v_report_id,
      'idempotent', true
    );
  end if;

  insert into public.venue_music_reports (
    user_id, venue_id, track_title, artist_name, report_source, feedback_is_correct
  )
  values (v_user_id, p_venue_id, v_title, v_artist, 'user_confirmation', p_is_correct)
  returning id into v_report_id;

  return jsonb_build_object(
    'ok', true,
    'message', case when p_is_correct
      then 'Thanks for confirming the venue and song. You are improving Riento accuracy.'
      else 'Thanks for flagging that result. You are improving Riento accuracy.'
    end,
    'report_id', v_report_id,
    'idempotent', false
  );
end;
$$;

revoke execute on function public.launch_submit_music_match_feedback(uuid, text, text, boolean) from public, anon, authenticated;

create or replace function public.launch_set_admin_venue_now_playing(
  p_venue_id uuid,
  p_track_title text,
  p_artist_name text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_title text := btrim(coalesce(p_track_title, ''));
  v_artist text := nullif(btrim(coalesce(p_artist_name, '')), '');
  v_now timestamptz := now();
begin
  if v_user_id is null or public.current_user_is_anonymous() then
    raise exception 'Permanent admin account required';
  end if;

  if not exists (select 1 from public.app_admins where user_id = v_user_id) then
    raise exception 'Admin access required';
  end if;

  if not coalesce(public.launch_feature_is_enabled('music_sharing'), false) then
    return jsonb_build_object('ok', false, 'message', 'Music sharing is temporarily paused.');
  end if;

  if v_title = '' or char_length(v_title) > 200
    or (v_artist is not null and char_length(v_artist) > 200) then
    return jsonb_build_object('ok', false, 'message', 'Track title and artist must each be 200 characters or fewer.');
  end if;

  if not exists (
    select 1 from public.venues
    where id = p_venue_id
      and verification_status in ('needs_verification', 'verified')
  ) then
    raise exception 'Venue is not available';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('trusted-venue-music:' || p_venue_id::text, 0)
  );

  if exists (
    select 1 from public.venue_now_playing current_track
    where current_track.venue_id = p_venue_id
      and current_track.source = 'manual'
      and lower(btrim(current_track.track_title)) = lower(v_title)
      and coalesce(lower(btrim(current_track.artist_name)), '') = coalesce(lower(v_artist), '')
      and current_track.observed_at > v_now - interval '2 minutes'
  ) then
    return jsonb_build_object('ok', true, 'message', 'This trusted song was already published.', 'idempotent', true);
  end if;

  if not public.consume_launch_rate_budget('admin_music_user', v_user_id::text, 600, 20)
    or not public.consume_launch_rate_budget('admin_music_venue', p_venue_id::text, 600, 12)
    or not public.consume_launch_rate_budget('admin_music_global', 'global', 3600, 300) then
    return jsonb_build_object('ok', false, 'message', 'Trusted music updates are temporarily rate limited.');
  end if;

  insert into public.venue_music_observations (
    venue_id, track_title, artist_name, source, confidence, observed_at, origin_report_id
  )
  values (p_venue_id, v_title, v_artist, 'manual', 1, v_now, null);

  insert into public.venue_now_playing (
    venue_id, track_title, artist_name, source, confidence,
    observed_at, expires_at, updated_at, origin_report_id
  )
  values (
    p_venue_id, v_title, v_artist, 'manual', 1,
    v_now, v_now + interval '45 minutes', v_now, null
  )
  on conflict (venue_id) do update
  set track_title = excluded.track_title,
      artist_name = excluded.artist_name,
      source = excluded.source,
      confidence = excluded.confidence,
      observed_at = excluded.observed_at,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at,
      origin_report_id = null;

  insert into public.admin_music_actions (venue_id, admin_user_id, track_title, artist_name)
  values (p_venue_id, v_user_id, v_title, v_artist);

  return jsonb_build_object(
    'ok', true,
    'message', 'Trusted now-playing entry published for 45 minutes.',
    'idempotent', false
  );
end;
$$;

revoke execute on function public.launch_set_admin_venue_now_playing(uuid, text, text) from public, anon, authenticated;

-- Legacy request queues are no longer part of the app's export/deletion path.
drop policy if exists "account_deletion_requests_select_own" on public.account_deletion_requests;
drop policy if exists "account_deletion_requests_insert_own" on public.account_deletion_requests;
drop policy if exists "account_deletion_requests_cancel_own" on public.account_deletion_requests;
drop policy if exists "data_export_requests_select_own" on public.data_export_requests;
drop policy if exists "data_export_requests_insert_own" on public.data_export_requests;
drop policy if exists "data_export_requests_cancel_own" on public.data_export_requests;
revoke all on table public.account_deletion_requests, public.data_export_requests from public, anon, authenticated;
grant all on table public.account_deletion_requests, public.data_export_requests to service_role;

create or replace function public.get_launch_readiness_status()
returns table (
  schema_version text,
  latest_snapshot_at timestamptz,
  crowd_writes_enabled boolean,
  ratings_enabled boolean,
  written_reviews_enabled boolean,
  venue_reports_enabled boolean,
  music_sharing_enabled boolean,
  audio_recognition_enabled boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    '2026-08-02-public-enrichment-cache-1'::text,
    (select max(created_at) from public.crowd_snapshots),
    controls.crowd_writes_enabled,
    controls.ratings_enabled,
    controls.written_reviews_enabled,
    controls.venue_reports_enabled,
    controls.music_sharing_enabled,
    controls.audio_recognition_enabled
  from public.launch_runtime_controls controls
  where controls.singleton = true;
$$;

revoke execute on function public.get_launch_readiness_status() from public;
grant execute on function public.get_launch_readiness_status() to anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if coalesce(new.is_anonymous, false) then
    return new;
  end if;

  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;

  return new;
end;
$$;

create or replace function public.cleanup_dynamic_data()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_pings integer := 0;
  v_checkins integer := 0;
  v_snapshots integer := 0;
  v_now_playing integer := 0;
  v_observations integer := 0;
  v_music_reports integer := 0;
begin
  delete from public.venue_pings where expires_at <= now();
  get diagnostics v_pings = row_count;

  delete from public.manual_checkins where expires_at <= now();
  get diagnostics v_checkins = row_count;

  delete from public.crowd_snapshots where window_end < now() - interval '7 days';
  get diagnostics v_snapshots = row_count;

  delete from public.venue_now_playing where expires_at <= now();
  get diagnostics v_now_playing = row_count;

  delete from public.venue_music_observations where observed_at < now() - interval '35 days';
  get diagnostics v_observations = row_count;

  delete from public.venue_music_reports where created_at < now() - interval '90 days';
  get diagnostics v_music_reports = row_count;

  delete from public.admin_venue_signals where expires_at < now() - interval '7 days';
  delete from public.curated_trending_venues where expires_at < now() - interval '30 days';

  return jsonb_build_object(
    'venue_pings', v_pings,
    'manual_checkins', v_checkins,
    'crowd_snapshots', v_snapshots,
    'venue_now_playing', v_now_playing,
    'venue_music_observations', v_observations,
    'venue_music_reports', v_music_reports
  );
end;
$$;

revoke execute on function public.cleanup_dynamic_data() from public;
grant execute on function public.cleanup_dynamic_data() to service_role;

create table if not exists public.music_recognition_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  venue_id uuid not null references public.venues (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists music_recognition_attempts_user_created_idx
on public.music_recognition_attempts (user_id, created_at desc);

alter table public.music_recognition_attempts enable row level security;

create or replace function public.claim_music_recognition_attempt(p_venue_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_recent_count integer;
begin
  if v_user_id is null then
    raise exception 'A private device session is required';
  end if;

  if not exists (
    select 1
    from public.venues
    where id = p_venue_id
      and verification_status in ('needs_verification', 'verified')
  ) then
    raise exception 'Venue is not available';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('music-recognition:' || v_user_id::text, 0)
  );

  if exists (
    select 1
    from public.music_recognition_attempts
    where user_id = v_user_id
      and created_at > now() - interval '1 minute'
  ) then
    return jsonb_build_object('ok', false, 'message', 'Music recognition cooldown active. Try again in a moment.');
  end if;

  select count(*)
  into v_recent_count
  from public.music_recognition_attempts
  where user_id = v_user_id
    and created_at > now() - interval '1 hour';

  if v_recent_count >= 3 then
    return jsonb_build_object('ok', false, 'message', 'Music recognition limit reached for this hour.');
  end if;

  insert into public.music_recognition_attempts (user_id, venue_id)
  values (v_user_id, p_venue_id);

  return jsonb_build_object('ok', true, 'message', 'Music recognition attempt accepted.');
end;
$$;

revoke execute on function public.claim_music_recognition_attempt(uuid) from public;
grant execute on function public.claim_music_recognition_attempt(uuid) to authenticated;

create or replace function public.cleanup_dynamic_data()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_pings integer := 0;
  v_checkins integer := 0;
  v_snapshots integer := 0;
  v_now_playing integer := 0;
  v_observations integer := 0;
  v_music_reports integer := 0;
  v_recognition_attempts integer := 0;
  v_deletion_operations integer := 0;
  v_admin_music_actions integer := 0;
begin
  delete from public.venue_pings where expires_at <= now();
  get diagnostics v_pings = row_count;

  delete from public.manual_checkins where expires_at <= now();
  get diagnostics v_checkins = row_count;

  delete from public.crowd_snapshots where window_end < now() - interval '7 days';
  get diagnostics v_snapshots = row_count;

  delete from public.venue_now_playing where expires_at <= now();
  get diagnostics v_now_playing = row_count;

  delete from public.venue_music_observations where observed_at < now() - interval '35 days';
  get diagnostics v_observations = row_count;

  delete from public.venue_music_reports where created_at < now() - interval '90 days';
  get diagnostics v_music_reports = row_count;

  delete from public.music_recognition_attempts where created_at < now() - interval '7 days';
  get diagnostics v_recognition_attempts = row_count;

  delete from public.identity_deletion_operations
  where status = 'completed' and completed_at < now() - interval '400 days';
  get diagnostics v_deletion_operations = row_count;

  delete from public.admin_music_actions where created_at < now() - interval '180 days';
  get diagnostics v_admin_music_actions = row_count;

  delete from public.admin_venue_signals where expires_at < now() - interval '7 days';
  delete from public.curated_trending_venues where expires_at < now() - interval '30 days';

  return jsonb_build_object(
    'venue_pings', v_pings,
    'manual_checkins', v_checkins,
    'crowd_snapshots', v_snapshots,
    'venue_now_playing', v_now_playing,
    'venue_music_observations', v_observations,
    'venue_music_reports', v_music_reports,
    'music_recognition_attempts', v_recognition_attempts,
    'identity_deletion_operations', v_deletion_operations,
    'admin_music_actions', v_admin_music_actions
  );
end;
$$;

revoke execute on function public.cleanup_dynamic_data() from public;
grant execute on function public.cleanup_dynamic_data() to service_role;

create or replace function public.get_admin_status()
returns boolean
language sql
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.app_admins
      where user_id = auth.uid()
    );
$$;

revoke execute on function public.get_admin_status() from public;
grant execute on function public.get_admin_status() to authenticated;

create or replace function public.get_venue_review_summaries()
returns table (
  venue_id uuid,
  average_rating numeric,
  review_count integer
)
language sql
security definer
set search_path = public
as $$
  select
    venue_reviews.venue_id,
    round(avg(venue_reviews.rating)::numeric, 1) as average_rating,
    count(*)::integer as review_count
  from public.venue_reviews
  where venue_reviews.hidden_at is null
  group by venue_reviews.venue_id;
$$;

revoke execute on function public.get_venue_review_summaries() from public;
grant execute on function public.get_venue_review_summaries() to anon, authenticated;

-- PostgreSQL cannot change a RETURNS TABLE row type with CREATE OR REPLACE.
-- Drop the existing moderated version before installing this baseline shape;
-- the final moderated definition later in this file drops and replaces it again.
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
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    venue_reviews.id,
    venue_reviews.venue_id,
    venue_reviews.rating,
    venue_reviews.comment,
    venue_reviews.created_at
  from public.venue_reviews
  where venue_reviews.venue_id = p_venue_id
    and venue_reviews.hidden_at is null
  order by venue_reviews.created_at desc
  limit least(50, greatest(1, coalesce(p_limit, 20)));
$$;

revoke execute on function public.get_public_venue_reviews(uuid, integer) from public;
grant execute on function public.get_public_venue_reviews(uuid, integer) to anon, authenticated;

create or replace function public.submit_venue_review(
  p_venue_id uuid,
  p_rating integer,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_recent_review_count integer;
  v_venue_exists boolean;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if public.current_user_is_anonymous() then
    raise exception 'Permanent admin account required';
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    return jsonb_build_object('ok', false, 'message', 'Choose a rating from 1 to 5.');
  end if;

  if v_comment is not null and length(v_comment) > 700 then
    return jsonb_build_object('ok', false, 'message', 'Keep reviews under 700 characters.');
  end if;

  select exists (
    select 1
    from public.venues
    where id = p_venue_id
      and verification_status in ('needs_verification', 'verified')
  ) into v_venue_exists;

  if not v_venue_exists then
    raise exception 'Venue is not available';
  end if;

  select count(*)
  from public.venue_reviews
  where user_id = v_user_id
    and created_at > now() - interval '10 minutes'
  into v_recent_review_count;

  if v_recent_review_count > 0 then
    return jsonb_build_object('ok', false, 'message', 'Review cooldown active. Try again in a few minutes.');
  end if;

  insert into public.venue_reviews (user_id, venue_id, rating, comment)
  values (v_user_id, p_venue_id, p_rating, v_comment);

  return jsonb_build_object('ok', true, 'message', 'Review posted. Thanks for adding context for other people.');
end;
$$;

revoke execute on function public.submit_venue_review(uuid, integer, text) from public;
grant execute on function public.submit_venue_review(uuid, integer, text) to authenticated;

create or replace function public.get_curated_trending_venues()
returns table (
  venue_id uuid,
  sort_rank integer,
  headline text,
  expires_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    curated_trending_venues.venue_id,
    curated_trending_venues.sort_rank,
    curated_trending_venues.headline,
    curated_trending_venues.expires_at
  from public.curated_trending_venues
  where curated_trending_venues.starts_at <= now()
    and curated_trending_venues.expires_at > now()
  order by curated_trending_venues.sort_rank asc, curated_trending_venues.updated_at desc;
$$;

revoke execute on function public.get_curated_trending_venues() from public;
grant execute on function public.get_curated_trending_venues() to anon, authenticated;

create or replace function public.submit_admin_venue_signal(
  p_venue_id uuid,
  p_crowd_level public.crowd_level default 'active'::public.crowd_level,
  p_note text default null,
  p_duration_minutes integer default 90
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_duration_minutes integer := least(240, greatest(15, coalesce(p_duration_minutes, 90)));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_signal_score numeric(5, 4);
  v_venue_exists boolean;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (select 1 from public.app_admins where user_id = v_user_id) then
    raise exception 'Admin access required';
  end if;

  select exists (
    select 1
    from public.venues
    where id = p_venue_id
      and verification_status in ('needs_verification', 'verified')
  ) into v_venue_exists;

  if not v_venue_exists then
    raise exception 'Venue is not available';
  end if;

  if v_note is not null and length(v_note) > 500 then
    return jsonb_build_object('ok', false, 'message', 'Keep admin notes under 500 characters.');
  end if;

  v_signal_score := case coalesce(p_crowd_level, 'active'::public.crowd_level)
    when 'packed'::public.crowd_level then 0.85
    when 'busy'::public.crowd_level then 0.62
    when 'active'::public.crowd_level then 0.35
    else 0.12
  end;

  insert into public.admin_venue_signals (venue_id, admin_user_id, crowd_level, signal_score, note, expires_at)
  values (p_venue_id, v_user_id, coalesce(p_crowd_level, 'active'::public.crowd_level), v_signal_score, v_note, now() + make_interval(mins => v_duration_minutes));

  perform public.refresh_venue_crowd_snapshot(p_venue_id, 90);

  return jsonb_build_object('ok', true, 'message', 'Admin venue signal added for launch-mode activity.');
end;
$$;

revoke execute on function public.submit_admin_venue_signal(uuid, public.crowd_level, text, integer) from public;
grant execute on function public.submit_admin_venue_signal(uuid, public.crowd_level, text, integer) to authenticated;

create or replace function public.set_curated_trending_venue(
  p_venue_id uuid,
  p_headline text default null,
  p_sort_rank integer default 100,
  p_duration_hours integer default 24
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_headline text := nullif(btrim(coalesce(p_headline, '')), '');
  v_sort_rank integer := least(999, greatest(1, coalesce(p_sort_rank, 100)));
  v_duration_hours integer := least(168, greatest(1, coalesce(p_duration_hours, 24)));
  v_venue_exists boolean;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if public.current_user_is_anonymous() then
    raise exception 'Permanent admin account required';
  end if;

  if not exists (select 1 from public.app_admins where user_id = v_user_id) then
    raise exception 'Admin access required';
  end if;

  if v_headline is not null and length(v_headline) > 120 then
    return jsonb_build_object('ok', false, 'message', 'Keep trending headlines under 120 characters.');
  end if;

  select exists (
    select 1
    from public.venues
    where id = p_venue_id
      and verification_status in ('needs_verification', 'verified')
  ) into v_venue_exists;

  if not v_venue_exists then
    raise exception 'Venue is not available';
  end if;

  insert into public.curated_trending_venues (venue_id, headline, sort_rank, starts_at, expires_at, created_by)
  values (p_venue_id, v_headline, v_sort_rank, now(), now() + make_interval(hours => v_duration_hours), v_user_id)
  on conflict (venue_id) do update set
    headline = excluded.headline,
    sort_rank = excluded.sort_rank,
    starts_at = excluded.starts_at,
    expires_at = excluded.expires_at,
    created_by = excluded.created_by,
    updated_at = now();

  return jsonb_build_object('ok', true, 'message', 'Venue featured on Trending.');
end;
$$;

revoke execute on function public.set_curated_trending_venue(uuid, text, integer, integer) from public;
grant execute on function public.set_curated_trending_venue(uuid, text, integer, integer) to authenticated;

create or replace function public.remove_curated_trending_venue(p_venue_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or public.current_user_is_anonymous() then
    raise exception 'Permanent admin account required';
  end if;

  if not exists (select 1 from public.app_admins where user_id = v_user_id) then
    raise exception 'Admin access required';
  end if;

  delete from public.curated_trending_venues
  where venue_id = p_venue_id;

  return jsonb_build_object('ok', true, 'message', 'Featured placement removed. Current activity may still keep this venue on Trending.');
end;
$$;

revoke execute on function public.remove_curated_trending_venue(uuid) from public;
grant execute on function public.remove_curated_trending_venue(uuid) to authenticated;

create or replace function public.submit_venue_music_report(
  p_venue_id uuid,
  p_track_title text,
  p_artist_name text default null,
  p_report_source public.now_playing_source default 'user_confirmation'::public.now_playing_source
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_track_title text := btrim(coalesce(p_track_title, ''));
  v_artist_name text := nullif(btrim(coalesce(p_artist_name, '')), '');
  v_report_source public.now_playing_source := coalesce(p_report_source, 'user_confirmation'::public.now_playing_source);
  v_observed_at timestamptz := now();
  v_report_id uuid;
  v_confidence numeric(4, 3);
  v_venue_exists boolean;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if v_report_source not in ('user_audio_match'::public.now_playing_source, 'user_confirmation'::public.now_playing_source) then
    raise exception 'Unsupported music report source';
  end if;

  if v_track_title = '' then
    return jsonb_build_object('ok', false, 'message', 'Track title is required.');
  end if;

  select exists (
    select 1
    from public.venues
    where id = p_venue_id
      and verification_status in ('needs_verification', 'verified')
  ) into v_venue_exists;

  if not v_venue_exists then
    raise exception 'Venue is not available';
  end if;

  v_confidence := case
    when v_report_source = 'user_audio_match'::public.now_playing_source then 0.9
    else 0.75
  end;

  insert into public.venue_music_reports (user_id, venue_id, track_title, artist_name, report_source)
  values (v_user_id, p_venue_id, v_track_title, v_artist_name, v_report_source)
  returning id into v_report_id;

  insert into public.venue_now_playing (
    venue_id,
    track_title,
    artist_name,
    album_name,
    spotify_track_id,
    source,
    confidence,
    observed_at,
    expires_at,
    updated_at
  )
  values (
    p_venue_id,
    v_track_title,
    v_artist_name,
    null,
    null,
    v_report_source,
    v_confidence,
    v_observed_at,
    v_observed_at + interval '45 minutes',
    v_observed_at
  )
  on conflict (venue_id) do update set
    track_title = excluded.track_title,
    artist_name = excluded.artist_name,
    album_name = excluded.album_name,
    spotify_track_id = excluded.spotify_track_id,
    source = excluded.source,
    confidence = excluded.confidence,
    observed_at = excluded.observed_at,
    expires_at = excluded.expires_at,
    updated_at = excluded.updated_at;

  insert into public.venue_music_observations (
    venue_id,
    track_title,
    artist_name,
    source,
    confidence,
    observed_at
  )
  values (
    p_venue_id,
    v_track_title,
    v_artist_name,
    v_report_source,
    v_confidence,
    v_observed_at
  );

  return jsonb_build_object(
    'ok', true,
    'message', 'Now-playing signal published for this venue.',
    'report_id', v_report_id
  );
end;
$$;

revoke execute on function public.submit_venue_music_report(uuid, text, text, public.now_playing_source) from public;
grant execute on function public.submit_venue_music_report(uuid, text, text, public.now_playing_source) to authenticated;

create or replace function public.refresh_crowd_snapshots(p_window_minutes integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_minutes integer := least(240, greatest(15, coalesce(p_window_minutes, 90)));
  v_window_start timestamptz := now() - make_interval(mins => least(240, greatest(15, coalesce(p_window_minutes, 90))));
  v_window_end timestamptz := now();
  v_inserted integer;
begin
  with signals as (
    select
      venue_id,
      greatest(0.2, 1 - (extract(epoch from (v_window_end - created_at)) / (v_window_minutes * 60))) * confidence as weight
    from public.venue_pings
    where created_at >= v_window_start
      and expires_at > v_window_end
    union all
    select
      venue_id,
      greatest(0.2, 1 - (extract(epoch from (v_window_end - created_at)) / (v_window_minutes * 60))) as weight
    from public.manual_checkins
    where created_at >= v_window_start
      and expires_at > v_window_end
  ),
  scored_signals as (
    select
      venue_id,
      count(*)::integer as sample_size,
      sum(weight) as weighted_signal
    from signals
    group by venue_id
  ),
  live_signal_scores as (
    select
      venues.id as venue_id,
      case
        when coalesce(scored_signals.sample_size, 0) = 0 then 0
        else greatest(
          0.3,
          least(
            1,
            coalesce(scored_signals.weighted_signal, 0) / greatest(coalesce(venues.capacity_estimate, 200) * 0.04, 3)
          )
        )
      end as signal_score,
      coalesce(scored_signals.sample_size, 0) as sample_size
    from public.venues
    left join scored_signals on scored_signals.venue_id = venues.id
    where venues.verification_status in ('needs_verification', 'verified')
  ),
  admin_scores as (
    select
      venue_id,
      max(signal_score) as signal_score,
      count(*)::integer as sample_size
    from public.admin_venue_signals
    where created_at <= v_window_end
      and expires_at > v_window_end
    group by venue_id
  ),
  venue_scores as (
    select
      live_signal_scores.venue_id,
      greatest(live_signal_scores.signal_score, coalesce(admin_scores.signal_score, 0)) as signal_score,
      live_signal_scores.sample_size + coalesce(admin_scores.sample_size, 0) as sample_size
    from live_signal_scores
    left join admin_scores on admin_scores.venue_id = live_signal_scores.venue_id
  ),
  inserted as (
    insert into public.crowd_snapshots (venue_id, crowd_level, has_signal, signal_score, sample_size, window_start, window_end)
    select
      venue_id,
      case
        when signal_score >= 0.78 then 'packed'::public.crowd_level
        when signal_score >= 0.55 then 'busy'::public.crowd_level
        when signal_score >= 0.28 then 'active'::public.crowd_level
        else 'quiet'::public.crowd_level
      end,
      sample_size > 0,
      round(signal_score::numeric, 4),
      sample_size,
      v_window_start,
      v_window_end
    from venue_scores
    returning 1
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end;
$$;

revoke execute on function public.refresh_crowd_snapshots(integer) from public;
grant execute on function public.refresh_crowd_snapshots(integer) to service_role;

alter table public.profiles enable row level security;
alter table public.app_admins enable row level security;
alter table public.venues enable row level security;
alter table public.venue_pings enable row level security;
alter table public.manual_checkins enable row level security;
alter table public.crowd_snapshots enable row level security;
alter table public.venue_reports enable row level security;
alter table public.venue_reviews enable row level security;
alter table public.user_saved_venues enable row level security;
alter table public.admin_venue_signals enable row level security;
alter table public.curated_trending_venues enable row level security;
alter table public.venue_now_playing enable row level security;
alter table public.venue_music_reports enable row level security;
alter table public.venue_music_observations enable row level security;
alter table public.account_deletion_requests enable row level security;
alter table public.data_export_requests enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "app_admins_select_own" on public.app_admins;
create policy "app_admins_select_own"
on public.app_admins for select
using (auth.uid() = user_id);

drop policy if exists "venues_public_read" on public.venues;
create policy "venues_public_read"
on public.venues for select
using (verification_status in ('needs_verification', 'verified'));

drop policy if exists "venue_pings_insert_own" on public.venue_pings;

drop policy if exists "venue_pings_select_own" on public.venue_pings;
create policy "venue_pings_select_own"
on public.venue_pings for select
using (auth.uid() = user_id);

drop policy if exists "venue_pings_delete_own" on public.venue_pings;
create policy "venue_pings_delete_own"
on public.venue_pings for delete
using (auth.uid() = user_id);

drop policy if exists "manual_checkins_insert_own" on public.manual_checkins;

drop policy if exists "manual_checkins_select_own" on public.manual_checkins;
create policy "manual_checkins_select_own"
on public.manual_checkins for select
using (auth.uid() = user_id);

drop policy if exists "manual_checkins_delete_own" on public.manual_checkins;
create policy "manual_checkins_delete_own"
on public.manual_checkins for delete
using (auth.uid() = user_id);

drop policy if exists "crowd_snapshots_public_read" on public.crowd_snapshots;
create policy "crowd_snapshots_public_read"
on public.crowd_snapshots for select
using (true);

drop policy if exists "venue_reports_insert_own" on public.venue_reports;

-- Final overrides must remain after the legacy-compatible definitions above.
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
  select public.submit_device_music_report(
    p_venue_id,
    p_track_title,
    p_artist_name,
    p_report_source
  );
$$;

revoke execute on function public.submit_venue_music_report(uuid, text, text, public.now_playing_source) from public;
grant execute on function public.submit_venue_music_report(uuid, text, text, public.now_playing_source) to authenticated;

drop policy if exists "venue_music_reports_insert_own" on public.venue_music_reports;

create or replace function public.get_admin_status()
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null
    and not public.current_user_is_anonymous()
    and exists (
      select 1
      from public.app_admins
      where user_id = auth.uid()
    );
$$;

revoke execute on function public.get_admin_status() from public;
grant execute on function public.get_admin_status() to authenticated;

drop policy if exists "app_admins_select_own" on public.app_admins;
create policy "app_admins_select_own"
on public.app_admins for select
to authenticated
using (not public.current_user_is_anonymous() and auth.uid() = user_id);

drop policy if exists "admin_venue_signals_select_admin" on public.admin_venue_signals;
create policy "admin_venue_signals_select_admin"
on public.admin_venue_signals for select
to authenticated
using (
  not public.current_user_is_anonymous()
  and exists (select 1 from public.app_admins where user_id = auth.uid())
);

drop policy if exists "curated_trending_venues_select_admin" on public.curated_trending_venues;
create policy "curated_trending_venues_select_admin"
on public.curated_trending_venues for select
to authenticated
using (
  not public.current_user_is_anonymous()
  and exists (select 1 from public.app_admins where user_id = auth.uid())
);

drop policy if exists "account_deletion_requests_select_own" on public.account_deletion_requests;
create policy "account_deletion_requests_select_own"
on public.account_deletion_requests for select
to authenticated
using (not public.current_user_is_anonymous() and auth.uid() = user_id);

drop policy if exists "account_deletion_requests_insert_own" on public.account_deletion_requests;
create policy "account_deletion_requests_insert_own"
on public.account_deletion_requests for insert
to authenticated
with check (not public.current_user_is_anonymous() and auth.uid() = user_id and status = 'requested');

drop policy if exists "account_deletion_requests_cancel_own" on public.account_deletion_requests;
create policy "account_deletion_requests_cancel_own"
on public.account_deletion_requests for update
to authenticated
using (not public.current_user_is_anonymous() and auth.uid() = user_id and status = 'requested')
with check (not public.current_user_is_anonymous() and auth.uid() = user_id and status = 'cancelled');

drop policy if exists "data_export_requests_select_own" on public.data_export_requests;
create policy "data_export_requests_select_own"
on public.data_export_requests for select
to authenticated
using (not public.current_user_is_anonymous() and auth.uid() = user_id);

drop policy if exists "data_export_requests_insert_own" on public.data_export_requests;
create policy "data_export_requests_insert_own"
on public.data_export_requests for insert
to authenticated
with check (not public.current_user_is_anonymous() and auth.uid() = user_id and status = 'requested');

drop policy if exists "data_export_requests_cancel_own" on public.data_export_requests;
create policy "data_export_requests_cancel_own"
on public.data_export_requests for update
to authenticated
using (not public.current_user_is_anonymous() and auth.uid() = user_id and status = 'requested')
with check (not public.current_user_is_anonymous() and auth.uid() = user_id and status = 'cancelled');

set check_function_bodies = on;

-- Final launch grants expose only broad crowd state. All contribution writes
-- use validated RPCs so cooldown and moderation checks cannot be bypassed by
-- direct table mutations.
revoke select on table public.crowd_snapshots from public, anon, authenticated;
grant select (
  id,
  venue_id,
  crowd_level,
  has_signal,
  window_start,
  window_end,
  created_at
) on table public.crowd_snapshots to anon, authenticated;

drop policy if exists "venue_pings_delete_own" on public.venue_pings;
drop policy if exists "manual_checkins_delete_own" on public.manual_checkins;
drop policy if exists "venue_reviews_delete_own" on public.venue_reviews;

revoke insert, update, delete on table public.venue_pings from anon, authenticated;
revoke insert, update, delete on table public.manual_checkins from anon, authenticated;
revoke insert, update, delete on table public.venue_reviews from anon, authenticated;
revoke insert, update, delete on table public.venue_reports from anon, authenticated;
revoke insert, update, delete on table public.venue_music_reports from anon, authenticated;

delete from public.venue_now_playing where btrim(track_title) = '';
update public.venue_now_playing
set track_title = left(btrim(track_title), 200),
    artist_name = nullif(left(btrim(coalesce(artist_name, '')), 200), '');

delete from public.venue_music_observations where btrim(track_title) = '';
update public.venue_music_observations
set track_title = left(btrim(track_title), 200),
    artist_name = nullif(left(btrim(coalesce(artist_name, '')), 200), '');

alter table public.venue_now_playing
drop constraint if exists venue_now_playing_title_length_check;

alter table public.venue_now_playing
add constraint venue_now_playing_title_length_check
check (char_length(btrim(track_title)) between 1 and 200);

alter table public.venue_now_playing
drop constraint if exists venue_now_playing_artist_length_check;

alter table public.venue_now_playing
add constraint venue_now_playing_artist_length_check
check (artist_name is null or char_length(btrim(artist_name)) <= 200);

alter table public.venue_music_observations
drop constraint if exists venue_music_observations_title_length_check;

alter table public.venue_music_observations
add constraint venue_music_observations_title_length_check
check (char_length(btrim(track_title)) between 1 and 200);

alter table public.venue_music_observations
drop constraint if exists venue_music_observations_artist_length_check;

alter table public.venue_music_observations
add constraint venue_music_observations_artist_length_check
check (artist_name is null or char_length(btrim(artist_name)) <= 200);

-- Refresh only the affected venue so an accepted device signal becomes useful
-- immediately instead of waiting for the two-minute full refresh job.
create or replace function public.refresh_venue_crowd_snapshot(
  p_venue_id uuid,
  p_window_minutes integer default 90
)
returns public.crowd_level
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_window_minutes integer := least(240, greatest(15, coalesce(p_window_minutes, 90)));
  v_window_start timestamptz := now() - make_interval(mins => least(240, greatest(15, coalesce(p_window_minutes, 90))));
  v_window_end timestamptz := now();
  v_capacity integer;
  v_sample_size integer := 0;
  v_weighted_signal numeric := 0;
  v_admin_sample_size integer := 0;
  v_admin_score numeric := 0;
  v_signal_score numeric := 0;
  v_crowd_level public.crowd_level;
begin
  select coalesce(capacity_estimate, 200)
  into v_capacity
  from public.venues
  where id = p_venue_id
    and verification_status in ('needs_verification', 'verified');

  if v_capacity is null then
    raise exception 'Venue is not available';
  end if;

  with signals as (
    select
      greatest(0.2, 1 - (extract(epoch from (v_window_end - created_at)) / (v_window_minutes * 60))) * confidence as weight
    from public.venue_pings
    where venue_id = p_venue_id
      and created_at >= v_window_start
      and expires_at > v_window_end

    union all

    select
      greatest(0.2, 1 - (extract(epoch from (v_window_end - created_at)) / (v_window_minutes * 60))) as weight
    from public.manual_checkins
    where venue_id = p_venue_id
      and created_at >= v_window_start
      and expires_at > v_window_end
  )
  select count(*)::integer, coalesce(sum(weight), 0)
  into v_sample_size, v_weighted_signal
  from signals;

  select count(*)::integer, coalesce(max(signal_score), 0)
  into v_admin_sample_size, v_admin_score
  from public.admin_venue_signals
  where venue_id = p_venue_id
    and created_at <= v_window_end
    and expires_at > v_window_end;

  v_signal_score := greatest(
    case
      when v_sample_size = 0 then 0
      else greatest(0.3, least(1, v_weighted_signal / greatest(v_capacity * 0.04, 3)))
    end,
    v_admin_score
  );

  v_crowd_level := case
    when v_signal_score >= 0.78 then 'packed'::public.crowd_level
    when v_signal_score >= 0.55 then 'busy'::public.crowd_level
    when v_signal_score >= 0.28 then 'active'::public.crowd_level
    else 'quiet'::public.crowd_level
  end;

  insert into public.crowd_snapshots (
    venue_id,
    crowd_level,
    has_signal,
    signal_score,
    sample_size,
    window_start,
    window_end
  )
  values (
    p_venue_id,
    v_crowd_level,
    v_sample_size + v_admin_sample_size > 0,
    round(v_signal_score::numeric, 4),
    v_sample_size + v_admin_sample_size,
    v_window_start,
    v_window_end
  );

  return v_crowd_level;
end;
$$;

revoke execute on function public.refresh_venue_crowd_snapshot(uuid, integer) from public;
grant execute on function public.refresh_venue_crowd_snapshot(uuid, integer) to service_role;

create or replace function public.get_latest_crowd_snapshots()
returns table (
  id uuid,
  venue_id uuid,
  crowd_level public.crowd_level,
  has_signal boolean,
  created_at timestamptz,
  snapshot_rank integer
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select recent.id, recent.venue_id, recent.crowd_level,
    recent.has_signal and recent.created_at > now() - interval '95 minutes',
    recent.created_at,
    recent.snapshot_rank
  from public.venues venues
  cross join lateral (
    select snapshots.id, snapshots.venue_id, snapshots.crowd_level, snapshots.has_signal, snapshots.created_at,
      row_number() over (order by snapshots.created_at desc, snapshots.id desc)::integer as snapshot_rank
    from public.crowd_snapshots snapshots
    where snapshots.venue_id = venues.id
    order by snapshots.created_at desc, snapshots.id desc
    limit 2
  ) recent
  where venues.verification_status in ('needs_verification', 'verified')
  order by venues.id, recent.snapshot_rank;
$$;

revoke execute on function public.get_latest_crowd_snapshots() from public;
grant execute on function public.get_latest_crowd_snapshots() to anon, authenticated;

create or replace function public.submit_venue_signal(
  p_venue_id uuid,
  p_source public.signal_source,
  p_confidence numeric default 1
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_recent_signal_count integer;
  v_confidence numeric;
  v_crowd_level public.crowd_level;
  v_previous_venue_ids uuid[];
  v_previous_venue_id uuid;
begin
  if v_user_id is null then
    raise exception 'A private device session is required';
  end if;

  if p_source is null or p_source not in ('gps'::public.signal_source, 'manual'::public.signal_source) then
    return jsonb_build_object('ok', false, 'message', 'Unsupported crowd signal source.');
  end if;

  if p_confidence is not null and (
    p_confidence::text = 'NaN'
    or p_confidence < 0
    or p_confidence > 1
  ) then
    return jsonb_build_object('ok', false, 'message', 'Signal confidence must be between 0 and 1.');
  end if;

  v_confidence := coalesce(p_confidence, 1);

  if not exists (
    select 1
    from public.venues
    where id = p_venue_id
      and verification_status in ('needs_verification', 'verified')
  ) then
    raise exception 'Venue is not available';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('venue-signal:' || v_user_id::text, 0)
  );

  if (
    p_source = 'gps'::public.signal_source
    and exists (
      select 1 from public.venue_pings
      where user_id = v_user_id
        and venue_id = p_venue_id
        and created_at > now() - interval '2 minutes'
        and expires_at > now()
    )
  ) or (
    p_source = 'manual'::public.signal_source
    and exists (
      select 1 from public.manual_checkins
      where user_id = v_user_id
        and venue_id = p_venue_id
        and created_at > now() - interval '2 minutes'
        and expires_at > now()
    )
  ) then
    select crowd_level
    into v_crowd_level
    from public.crowd_snapshots
    where venue_id = p_venue_id
    order by created_at desc, id desc
    limit 1;

    if v_crowd_level is null then
      v_crowd_level := public.refresh_venue_crowd_snapshot(p_venue_id, 90);
    end if;

    return jsonb_build_object(
      'ok', true,
      'message', 'Venue signal was already shared.',
      'crowd_level', v_crowd_level,
      'idempotent', true
    );
  end if;

  select count(*)
  into v_recent_signal_count
  from (
    select created_at
    from public.venue_pings
    where user_id = v_user_id
      and created_at > now() - interval '2 minutes'

    union all

    select created_at
    from public.manual_checkins
    where user_id = v_user_id
      and created_at > now() - interval '2 minutes'
  ) recent_signals;

  if v_recent_signal_count > 0 then
    return jsonb_build_object('ok', false, 'message', 'Signal cooldown active. Try again in a moment.');
  end if;

  select array_agg(distinct venue_id)
  into v_previous_venue_ids
  from (
    select venue_id
    from public.venue_pings
    where user_id = v_user_id
      and expires_at > now()

    union all

    select venue_id
    from public.manual_checkins
    where user_id = v_user_id
      and expires_at > now()
  ) active_venues;

  delete from public.venue_pings
  where user_id = v_user_id
    and expires_at > now();

  delete from public.manual_checkins
  where user_id = v_user_id
    and expires_at > now();

  if p_source = 'manual'::public.signal_source then
    insert into public.manual_checkins (user_id, venue_id)
    values (v_user_id, p_venue_id);
  else
    insert into public.venue_pings (user_id, venue_id, source, confidence)
    values (v_user_id, p_venue_id, 'gps'::public.signal_source, v_confidence);
  end if;

  v_crowd_level := public.refresh_venue_crowd_snapshot(p_venue_id, 90);

  foreach v_previous_venue_id in array coalesce(v_previous_venue_ids, array[]::uuid[])
  loop
    if v_previous_venue_id <> p_venue_id then
      perform public.refresh_venue_crowd_snapshot(v_previous_venue_id, 90);
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'message', case when p_source = 'manual'::public.signal_source then 'Manual placement shared.' else 'GPS venue signal shared.' end,
    'crowd_level', v_crowd_level
  );
end;
$$;

revoke execute on function public.submit_venue_signal(uuid, public.signal_source, numeric) from public;
grant execute on function public.submit_venue_signal(uuid, public.signal_source, numeric) to authenticated;
create policy "venue_reports_insert_own"
on public.venue_reports for insert
with check (auth.uid() = user_id);

drop policy if exists "venue_reports_select_own" on public.venue_reports;
create policy "venue_reports_select_own"
on public.venue_reports for select
using (auth.uid() = user_id);

drop policy if exists "venue_reviews_select_own" on public.venue_reviews;
create policy "venue_reviews_select_own"
on public.venue_reviews for select
using (auth.uid() = user_id);

drop policy if exists "venue_reviews_delete_own" on public.venue_reviews;
create policy "venue_reviews_delete_own"
on public.venue_reviews for delete
using (auth.uid() = user_id);

drop policy if exists "user_saved_venues_select_own" on public.user_saved_venues;
create policy "user_saved_venues_select_own"
on public.user_saved_venues for select
using (auth.uid() = user_id);

drop policy if exists "user_saved_venues_insert_own" on public.user_saved_venues;
create policy "user_saved_venues_insert_own"
on public.user_saved_venues for insert
with check (auth.uid() = user_id);

drop policy if exists "user_saved_venues_update_own" on public.user_saved_venues;
create policy "user_saved_venues_update_own"
on public.user_saved_venues for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "user_saved_venues_delete_own" on public.user_saved_venues;
create policy "user_saved_venues_delete_own"
on public.user_saved_venues for delete
using (auth.uid() = user_id);

drop policy if exists "admin_venue_signals_select_admin" on public.admin_venue_signals;
create policy "admin_venue_signals_select_admin"
on public.admin_venue_signals for select
using (exists (select 1 from public.app_admins where user_id = auth.uid()));

drop policy if exists "curated_trending_venues_select_admin" on public.curated_trending_venues;
create policy "curated_trending_venues_select_admin"
on public.curated_trending_venues for select
using (exists (select 1 from public.app_admins where user_id = auth.uid()));

drop policy if exists "venue_now_playing_public_read" on public.venue_now_playing;
create policy "venue_now_playing_public_read"
on public.venue_now_playing for select
using (expires_at > now());

drop policy if exists "venue_music_reports_insert_own" on public.venue_music_reports;
create policy "venue_music_reports_insert_own"
on public.venue_music_reports for insert
with check (auth.uid() = user_id);

drop policy if exists "venue_music_reports_select_own" on public.venue_music_reports;
create policy "venue_music_reports_select_own"
on public.venue_music_reports for select
using (auth.uid() = user_id);

drop policy if exists "venue_music_observations_public_read" on public.venue_music_observations;
create policy "venue_music_observations_public_read"
on public.venue_music_observations for select
using (confidence >= 0.6);

drop policy if exists "account_deletion_requests_select_own" on public.account_deletion_requests;
create policy "account_deletion_requests_select_own"
on public.account_deletion_requests for select
using (auth.uid() = user_id);

drop policy if exists "account_deletion_requests_insert_own" on public.account_deletion_requests;
create policy "account_deletion_requests_insert_own"
on public.account_deletion_requests for insert
with check (auth.uid() = user_id and status = 'requested');

drop policy if exists "account_deletion_requests_cancel_own" on public.account_deletion_requests;
create policy "account_deletion_requests_cancel_own"
on public.account_deletion_requests for update
using (auth.uid() = user_id and status = 'requested')
with check (auth.uid() = user_id and status = 'cancelled');

drop policy if exists "data_export_requests_select_own" on public.data_export_requests;
create policy "data_export_requests_select_own"
on public.data_export_requests for select
using (auth.uid() = user_id);

drop policy if exists "data_export_requests_insert_own" on public.data_export_requests;
create policy "data_export_requests_insert_own"
on public.data_export_requests for insert
with check (auth.uid() = user_id and status = 'requested');

drop policy if exists "data_export_requests_cancel_own" on public.data_export_requests;
create policy "data_export_requests_cancel_own"
on public.data_export_requests for update
using (auth.uid() = user_id and status = 'requested')
with check (auth.uid() = user_id and status = 'cancelled');

-- Accountless device sessions use Supabase anonymous Auth. These definitions
-- intentionally keep one-device crowd and music publication for launch while
-- making each write atomic, bounded, and attributable to auth.uid().

create or replace function public.current_user_is_anonymous()
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true';
$$;

revoke execute on function public.current_user_is_anonymous() from public;
grant execute on function public.current_user_is_anonymous() to authenticated;

-- Ratings remain account-free. Written reviews require a permanent account and
-- stay private until an operator approves them.
update public.venue_reviews
set comment = null
where comment is not null
  and btrim(comment) = '';

delete from public.venue_reviews
where user_id is null;

alter table public.venue_reviews
alter column user_id set not null;

with ranked_ratings as (
  select
    id,
    row_number() over (
      partition by user_id, venue_id
      order by updated_at desc, created_at desc, id desc
    ) as duplicate_rank
  from public.venue_reviews
  where user_id is not null
)
delete from public.venue_reviews ratings
using ranked_ratings ranked
where ratings.id = ranked.id
  and ranked.duplicate_rank > 1;

create unique index if not exists venue_reviews_user_venue_uidx
on public.venue_reviews (user_id, venue_id);

alter table public.venue_reviews
drop constraint if exists venue_reviews_rating_only_check;

alter table public.venue_reviews
add column if not exists moderation_status text not null default 'approved';

alter table public.venue_reviews
add column if not exists moderation_note text;

alter table public.venue_reviews
add column if not exists moderated_at timestamptz;

alter table public.venue_reviews
drop constraint if exists venue_reviews_moderation_status_check;

alter table public.venue_reviews
add constraint venue_reviews_moderation_status_check
check (moderation_status in ('approved', 'pending', 'rejected'));

alter table public.venue_reviews
drop constraint if exists venue_reviews_comment_length_check;

update public.venue_reviews
set comment = null
where comment is not null
  and char_length(btrim(comment)) < 10;

alter table public.venue_reviews
add constraint venue_reviews_comment_length_check
check (comment is null or char_length(btrim(comment)) between 10 and 700)
not valid;

update public.venue_reviews
set moderation_status = 'pending'
where comment is not null
  and moderation_status = 'approved'
  and moderated_at is null;

create table if not exists public.venue_review_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  review_id uuid not null references public.venue_reviews (id) on delete cascade,
  reason text not null check (reason in ('abusive', 'false_information', 'harassment', 'other', 'personal_information', 'safety_threat', 'spam')),
  details text check (details is null or char_length(btrim(details)) <= 500),
  reported_comment text,
  review_content_hash text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.venue_review_reports add column if not exists reported_comment text;
alter table public.venue_review_reports add column if not exists review_content_hash text;

update public.venue_review_reports reports
set reported_comment = reviews.comment,
    review_content_hash = encode(digest(coalesce(reviews.comment, '') || '|' || reviews.rating::text, 'sha256'), 'hex')
from public.venue_reviews reviews
where reports.review_id = reviews.id
  and (reports.reported_comment is null or reports.review_content_hash is null);

delete from public.venue_review_reports
where reported_comment is null or review_content_hash is null;

alter table public.venue_review_reports alter column reported_comment set not null;
alter table public.venue_review_reports alter column review_content_hash set not null;

alter table public.venue_review_reports
drop constraint if exists venue_review_reports_reason_check;

alter table public.venue_review_reports
add constraint venue_review_reports_reason_check
check (reason in ('abusive', 'false_information', 'harassment', 'other', 'personal_information', 'safety_threat', 'spam'));

alter table public.venue_review_reports
drop constraint if exists venue_review_reports_user_id_review_id_key;

drop index if exists public.venue_review_reports_user_review_active_uidx;

with duplicate_reports as (
  select id, row_number() over (
    partition by user_id, review_id, review_content_hash
    order by created_at desc, id desc
  ) as duplicate_rank
  from public.venue_review_reports
)
delete from public.venue_review_reports reports
using duplicate_reports duplicates
where reports.id = duplicates.id
  and duplicates.duplicate_rank > 1;

create unique index if not exists venue_review_reports_user_review_content_uidx
on public.venue_review_reports (user_id, review_id, review_content_hash);

create table if not exists public.review_user_blocks (
  blocker_user_id uuid not null references auth.users (id) on delete cascade,
  blocked_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_user_id, blocked_user_id),
  check (blocker_user_id <> blocked_user_id)
);

create table if not exists public.review_terms_acceptances (
  user_id uuid primary key references auth.users (id) on delete cascade,
  terms_version text not null check (char_length(terms_version) between 1 and 40),
  accepted_at timestamptz not null default now()
);

create table if not exists public.review_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.venue_reviews (id) on delete cascade,
  action text not null check (action in ('approve', 'reject')),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  operator_identifier text not null check (char_length(btrim(operator_identifier)) between 1 and 120),
  created_at timestamptz not null default now()
);

create index if not exists venue_review_reports_review_created_idx
on public.venue_review_reports (review_id, created_at desc);

create index if not exists venue_review_reports_unresolved_idx
on public.venue_review_reports (created_at)
where resolved_at is null;

alter table public.venue_review_reports enable row level security;
alter table public.review_user_blocks enable row level security;
alter table public.review_terms_acceptances enable row level security;
alter table public.review_moderation_actions enable row level security;

drop policy if exists "venue_review_reports_select_own" on public.venue_review_reports;
create policy "venue_review_reports_select_own"
on public.venue_review_reports for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "review_user_blocks_select_own" on public.review_user_blocks;
drop policy if exists "review_user_blocks_delete_own" on public.review_user_blocks;

drop policy if exists "review_terms_acceptances_select_own" on public.review_terms_acceptances;
create policy "review_terms_acceptances_select_own"
on public.review_terms_acceptances for select
to authenticated
using (auth.uid() = user_id);

revoke insert, update, delete on table public.venue_review_reports from anon, authenticated;
revoke all on table public.review_user_blocks from anon, authenticated;
grant select on table public.venue_review_reports to authenticated;
revoke insert, update, delete on table public.review_terms_acceptances from anon, authenticated;
grant select on table public.review_terms_acceptances to authenticated;
revoke all on table public.review_moderation_actions from anon, authenticated;

create or replace function public.accept_review_terms(p_terms_version text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or public.current_user_is_anonymous() then
    return jsonb_build_object('ok', false, 'message', 'A permanent review account is required.');
  end if;

  if p_terms_version <> '2026-07-23' then
    return jsonb_build_object('ok', false, 'message', 'Review terms have changed. Read and accept the current version.');
  end if;

  insert into public.review_terms_acceptances (user_id, terms_version, accepted_at)
  values (v_user_id, p_terms_version, now())
  on conflict (user_id) do update
  set terms_version = excluded.terms_version,
      accepted_at = excluded.accepted_at;

  return jsonb_build_object('ok', true, 'message', 'Review terms accepted.');
end;
$$;

revoke execute on function public.accept_review_terms(text) from public;
grant execute on function public.accept_review_terms(text) to authenticated;

create or replace function public.get_device_data_export()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'A private device session is required';
  end if;

  return jsonb_build_object(
    'exportedAt', now(),
    'privateDeviceSessionId', v_user_id,
    'profile', (select to_jsonb(rows) from (select username, avatar_url, gps_on_map_open, manual_placement_enabled, created_at, updated_at from public.profiles where id = v_user_id) rows),
    'venueSignals', coalesce((select jsonb_agg(to_jsonb(rows)) from (select venue_id, source, confidence, created_at, expires_at from public.venue_pings where user_id = v_user_id) rows), '[]'::jsonb),
    'manualPlacements', coalesce((select jsonb_agg(to_jsonb(rows)) from (select venue_id, created_at, expires_at from public.manual_checkins where user_id = v_user_id) rows), '[]'::jsonb),
    'venueReports', coalesce((select jsonb_agg(to_jsonb(rows)) from (select id, venue_id, reason, details, resolved_at, created_at from public.venue_reports where user_id = v_user_id) rows), '[]'::jsonb),
    'ratingsAndReviews', coalesce((select jsonb_agg(to_jsonb(rows)) from (select id, venue_id, rating, comment, moderation_status, moderated_at, created_at, updated_at from public.venue_reviews where user_id = v_user_id) rows), '[]'::jsonb),
    'writtenReviewReports', coalesce((select jsonb_agg(to_jsonb(rows)) from (select id, review_id, reason, details, reported_comment, resolved_at, created_at from public.venue_review_reports where user_id = v_user_id) rows), '[]'::jsonb),
    'reviewAuthorBlockCount', (select count(*) from public.review_user_blocks where blocker_user_id = v_user_id),
    'reviewTermsAcceptance', (select to_jsonb(rows) from (select terms_version, accepted_at from public.review_terms_acceptances where user_id = v_user_id) rows),
    'musicReports', coalesce((select jsonb_agg(to_jsonb(rows)) from (select id, venue_id, track_title, artist_name, report_source, feedback_is_correct, details, resolved_at, created_at from public.venue_music_reports where user_id = v_user_id) rows), '[]'::jsonb),
    'musicRecognitionAttempts', coalesce((select jsonb_agg(to_jsonb(rows)) from (select venue_id, created_at from public.music_recognition_attempts where user_id = v_user_id) rows), '[]'::jsonb),
    'backendSavedVenues', coalesce((select jsonb_agg(to_jsonb(rows)) from (select venue_id, created_at from public.user_saved_venues where user_id = v_user_id) rows), '[]'::jsonb),
    'accountDeletionRequests', coalesce((select jsonb_agg(to_jsonb(rows)) from (select id, requested_email, status, created_at, updated_at from public.account_deletion_requests where user_id = v_user_id) rows), '[]'::jsonb),
    'dataExportRequests', coalesce((select jsonb_agg(to_jsonb(rows)) from (select id, requested_email, status, completed_at, created_at, updated_at from public.data_export_requests where user_id = v_user_id) rows), '[]'::jsonb),
    'adminMembership', (select to_jsonb(rows) from (select note, created_at from public.app_admins where user_id = v_user_id) rows),
    'adminVenueSignals', coalesce((select jsonb_agg(to_jsonb(rows)) from (select id, venue_id, crowd_level, signal_score, note, created_at, expires_at from public.admin_venue_signals where admin_user_id = v_user_id) rows), '[]'::jsonb),
    'curatedTrendingVenues', coalesce((select jsonb_agg(to_jsonb(rows)) from (select venue_id, headline, sort_rank, starts_at, expires_at, created_at, updated_at from public.curated_trending_venues where created_by = v_user_id) rows), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.get_device_data_export() from public;
grant execute on function public.get_device_data_export() to authenticated;

create or replace function public.delete_identity_data(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_user_id is null then
    raise exception 'User ID is required';
  end if;

  delete from public.admin_venue_signals where admin_user_id = p_user_id;
  delete from public.curated_trending_venues where created_by = p_user_id;
  delete from public.review_user_blocks where blocker_user_id = p_user_id or blocked_user_id = p_user_id;
  delete from public.venue_review_reports where user_id = p_user_id;
  delete from public.review_terms_acceptances where user_id = p_user_id;
  delete from public.venue_music_reports where user_id = p_user_id;
  delete from public.venue_reviews where user_id = p_user_id;
  delete from public.venue_reports where user_id = p_user_id;
  delete from public.user_saved_venues where user_id = p_user_id;
  delete from public.music_recognition_attempts where user_id = p_user_id;
  delete from public.manual_checkins where user_id = p_user_id;
  delete from public.venue_pings where user_id = p_user_id;
  delete from public.data_export_requests where user_id = p_user_id;
  delete from public.account_deletion_requests where user_id = p_user_id;
  delete from public.profiles where id = p_user_id;
  delete from public.app_admins where user_id = p_user_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.delete_identity_data(uuid) from public, anon, authenticated;
grant execute on function public.delete_identity_data(uuid) to service_role;

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
security definer
set search_path = pg_catalog, public
as $$
  select
    reviews.id,
    reviews.venue_id,
    reviews.rating,
    case when reviews.moderation_status = 'approved' or reviews.user_id = auth.uid() then reviews.comment else null end,
    reviews.updated_at,
    case
      when reviews.user_id = auth.uid() then reviews.moderation_status
      when reviews.moderation_status = 'approved' then 'approved'
      else null
    end,
    coalesce(reviews.user_id = auth.uid(), false)
  from public.venue_reviews reviews
  where reviews.venue_id = p_venue_id
    and reviews.hidden_at is null
    and not exists (
      select 1
      from public.review_user_blocks blocks
      where blocks.blocker_user_id = auth.uid()
        and blocks.blocked_user_id = reviews.user_id
    )
  order by coalesce(reviews.user_id = auth.uid(), false) desc, reviews.updated_at desc
  limit least(50, greatest(1, coalesce(p_limit, 20)));
$$;

revoke execute on function public.get_public_venue_reviews(uuid, integer) from public;
grant execute on function public.get_public_venue_reviews(uuid, integer) to anon, authenticated;

create or replace function public.submit_venue_review(
  p_venue_id uuid,
  p_rating integer,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if v_user_id is null then
    raise exception 'A private device session is required';
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    return jsonb_build_object('ok', false, 'message', 'Choose a rating from 1 to 5.');
  end if;

  if v_comment is not null and public.current_user_is_anonymous() then
    return jsonb_build_object('ok', false, 'message', 'Create or sign in to an account before adding a written review.');
  end if;

  if v_comment is not null and not exists (
    select 1
    from public.review_terms_acceptances
    where user_id = v_user_id
      and terms_version = '2026-07-23'
  ) then
    return jsonb_build_object('ok', false, 'message', 'Accept the current Terms and Community Guidelines before adding a written review.');
  end if;

  if v_comment is not null and char_length(v_comment) < 10 then
    return jsonb_build_object('ok', false, 'message', 'Written reviews must be at least 10 characters.');
  end if;

  if v_comment is not null and char_length(v_comment) > 700 then
    return jsonb_build_object('ok', false, 'message', 'Keep written reviews under 700 characters.');
  end if;

  if not exists (
    select 1
    from public.venues
    where id = p_venue_id
      and verification_status in ('needs_verification', 'verified')
  ) then
    raise exception 'Venue is not available';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('venue-rating:' || v_user_id::text, 0)
  );

  if exists (
    select 1
    from public.venue_reviews reviews
    join public.venue_review_reports reports on reports.review_id = reviews.id
    where reviews.user_id = v_user_id
      and reviews.venue_id = p_venue_id
      and reports.resolved_at is null
      and coalesce(reviews.comment, '') <> coalesce(v_comment, '')
  ) then
    return jsonb_build_object('ok', false, 'message', 'Written text under active moderation cannot be changed yet. The number rating can still be saved with the existing text.');
  end if;

  if exists (
    select 1
    from public.venue_reviews
    where user_id = v_user_id
      and venue_id = p_venue_id
      and rating = p_rating
      and coalesce(comment, '') = coalesce(v_comment, '')
      and updated_at > now() - interval '10 minutes'
  ) then
    return jsonb_build_object(
      'ok', true,
      'message', case when v_comment is null then 'Rating was already saved.' else 'Rating saved. Written review is pending moderation.' end,
      'idempotent', true
    );
  end if;

  if exists (
    select 1
    from public.venue_reviews
    where user_id = v_user_id
      and updated_at > now() - interval '10 minutes'
  ) then
    return jsonb_build_object('ok', false, 'message', 'Rating cooldown active. Try again in a few minutes.');
  end if;

  insert into public.venue_reviews (user_id, venue_id, rating, comment, moderation_status)
  values (v_user_id, p_venue_id, p_rating, v_comment, case when v_comment is null then 'approved' else 'pending' end)
  on conflict (user_id, venue_id) do update
  set rating = excluded.rating,
      comment = excluded.comment,
      moderation_status = case
        when coalesce(public.venue_reviews.comment, '') = coalesce(excluded.comment, '') then public.venue_reviews.moderation_status
        else excluded.moderation_status
      end,
      moderation_note = case
        when coalesce(public.venue_reviews.comment, '') = coalesce(excluded.comment, '') then public.venue_reviews.moderation_note
        else null
      end,
      moderated_at = case
        when coalesce(public.venue_reviews.comment, '') = coalesce(excluded.comment, '') then public.venue_reviews.moderated_at
        else null
      end,
      hidden_at = case when excluded.comment is null then null else public.venue_reviews.hidden_at end,
      hidden_reason = case when excluded.comment is null then null else public.venue_reviews.hidden_reason end,
      updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'message', case when v_comment is null then 'Rating saved.' else 'Rating saved. Written review is pending moderation.' end,
    'idempotent', false
  );
end;
$$;

revoke execute on function public.submit_venue_review(uuid, integer, text) from public;
grant execute on function public.submit_venue_review(uuid, integer, text) to authenticated;

create or replace function public.submit_review_report(
  p_review_id uuid,
  p_reason text,
  p_details text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_review_user_id uuid;
  v_reported_comment text;
  v_review_content_hash text;
  v_reason text := lower(btrim(coalesce(p_reason, '')));
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
begin
  if v_user_id is null then
    raise exception 'A private device session is required';
  end if;

  if v_reason not in ('abusive', 'false_information', 'harassment', 'other', 'personal_information', 'safety_threat', 'spam') then
    return jsonb_build_object('ok', false, 'message', 'Unsupported review-report reason.');
  end if;

  if v_details is not null and char_length(v_details) > 500 then
    return jsonb_build_object('ok', false, 'message', 'Keep report details under 500 characters.');
  end if;

  select user_id, comment, encode(digest(comment || '|' || rating::text, 'sha256'), 'hex')
  into v_review_user_id, v_reported_comment, v_review_content_hash
  from public.venue_reviews
  where id = p_review_id
    and comment is not null
    and moderation_status = 'approved'
    and hidden_at is null;

  if v_review_user_id is null then
    return jsonb_build_object('ok', false, 'message', 'Written review is no longer available.');
  end if;

  if v_review_user_id = v_user_id then
    return jsonb_build_object('ok', false, 'message', 'You cannot report your own review.');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('review-report:' || v_user_id::text, 0));

  if exists (
    select 1 from public.venue_review_reports
    where user_id = v_user_id
      and review_id = p_review_id
      and review_content_hash = v_review_content_hash
  ) then
    return jsonb_build_object('ok', true, 'message', 'This version of the review was already reported.', 'idempotent', true);
  end if;

  if exists (
    select 1 from public.venue_review_reports
    where user_id = v_user_id and created_at > now() - interval '2 minutes'
  ) then
    return jsonb_build_object('ok', false, 'message', 'Review-report cooldown active. Try again in a moment.');
  end if;

  insert into public.venue_review_reports (user_id, review_id, reason, details, reported_comment, review_content_hash)
  values (v_user_id, p_review_id, v_reason, v_details, v_reported_comment, v_review_content_hash);

  return jsonb_build_object('ok', true, 'message', 'Review reported for moderation.');
end;
$$;

revoke execute on function public.submit_review_report(uuid, text, text) from public;
grant execute on function public.submit_review_report(uuid, text, text) to authenticated;

create or replace function public.block_review_author(p_review_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_review_user_id uuid;
begin
  if v_user_id is null then
    raise exception 'A private device session is required';
  end if;

  select user_id
  into v_review_user_id
  from public.venue_reviews
  where id = p_review_id
    and comment is not null
    and moderation_status = 'approved'
    and hidden_at is null;

  if v_review_user_id is null then
    return jsonb_build_object('ok', false, 'message', 'Written review is no longer available.');
  end if;

  if v_review_user_id = v_user_id then
    return jsonb_build_object('ok', false, 'message', 'You cannot block yourself.');
  end if;

  insert into public.review_user_blocks (blocker_user_id, blocked_user_id)
  values (v_user_id, v_review_user_id)
  on conflict (blocker_user_id, blocked_user_id) do nothing;

  return jsonb_build_object('ok', true, 'message', 'Reviewer blocked on this account or device session.');
end;
$$;

revoke execute on function public.block_review_author(uuid) from public;
grant execute on function public.block_review_author(uuid) to authenticated;

create or replace function public.clear_review_author_blocks()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_deleted integer := 0;
begin
  if v_user_id is null then
    raise exception 'A private device session is required';
  end if;

  delete from public.review_user_blocks where blocker_user_id = v_user_id;
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('ok', true, 'message', case when v_deleted = 0 then 'No blocked reviewers were stored.' else 'Blocked reviewers were cleared.' end);
end;
$$;

revoke execute on function public.clear_review_author_blocks() from public;
grant execute on function public.clear_review_author_blocks() to authenticated;

create or replace function public.cleanup_review_moderation_data()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_deleted integer := 0;
  v_actions_deleted integer := 0;
begin
  delete from public.venue_review_reports
  where resolved_at is not null
    and resolved_at < now() - interval '90 days';
  get diagnostics v_deleted = row_count;

  delete from public.review_moderation_actions
  where created_at < now() - interval '1 year';
  get diagnostics v_actions_deleted = row_count;
  return v_deleted + v_actions_deleted;
end;
$$;

revoke execute on function public.cleanup_review_moderation_data() from public;
grant execute on function public.cleanup_review_moderation_data() to service_role;

drop function if exists public.moderate_venue_review(uuid, text, text, timestamptz);

create or replace function public.moderate_venue_review(
  p_review_id uuid,
  p_action text,
  p_reason text,
  p_operator_identifier text,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_operator_identifier text := btrim(coalesce(p_operator_identifier, ''));
  v_review public.venue_reviews%rowtype;
begin
  if v_action not in ('approve', 'reject') then
    return jsonb_build_object('ok', false, 'message', 'Unsupported moderation action.');
  end if;

  if v_reason = '' or char_length(v_reason) > 500 then
    return jsonb_build_object('ok', false, 'message', 'A moderation reason between 1 and 500 characters is required.');
  end if;

  if v_operator_identifier = '' or char_length(v_operator_identifier) > 120 then
    return jsonb_build_object('ok', false, 'message', 'A trusted operator identifier is required.');
  end if;

  select * into v_review
  from public.venue_reviews
  where id = p_review_id
  for update;

  if v_review.id is null then
    return jsonb_build_object('ok', false, 'message', 'Review not found.');
  end if;

  if v_review.comment is null then
    return jsonb_build_object('ok', false, 'message', 'The review has no written text to moderate.');
  end if;

  if v_review.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('ok', false, 'message', 'Review changed while moderation was in progress.');
  end if;

  if v_action = 'approve' and not exists (
    select 1
    from public.review_terms_acceptances
    where user_id = v_review.user_id
      and terms_version = '2026-07-23'
  ) then
    return jsonb_build_object('ok', false, 'message', 'The review owner has not accepted the current Terms and Community Guidelines.');
  end if;

  update public.venue_reviews
  set moderation_status = case when v_action = 'approve' then 'approved' else 'rejected' end,
      moderation_note = v_reason,
      moderated_at = now(),
      hidden_at = null,
      hidden_reason = null
  where id = p_review_id;

  update public.venue_review_reports
  set resolved_at = now()
  where review_id = p_review_id
    and resolved_at is null;

  insert into public.review_moderation_actions (review_id, action, reason, operator_identifier)
  values (p_review_id, v_action, v_reason, v_operator_identifier);

  return jsonb_build_object('ok', true, 'message', case when v_action = 'approve' then 'Review approved.' else 'Review rejected.' end);
end;
$$;

revoke execute on function public.moderate_venue_review(uuid, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.moderate_venue_review(uuid, text, text, text, timestamptz) to service_role;

-- Reports go through a validated RPC instead of direct table inserts.
alter table public.venue_reports
drop constraint if exists venue_reports_reason_check;

update public.venue_reports
set reason = case
  when venue_id is null then 'missing_venue'
  when reason = 'missing_venue' then 'other'
  when reason in ('closed', 'duplicate', 'other', 'wrong_address', 'wrong_crowd', 'wrong_hours', 'wrong_music') then reason
  else 'other'
end;

update public.venue_reports
set details = left(details, 1000)
where details is not null
  and char_length(btrim(details)) > 1000;

alter table public.venue_reports
add constraint venue_reports_reason_check
check (reason in ('closed', 'duplicate', 'missing_venue', 'other', 'wrong_address', 'wrong_crowd', 'wrong_hours', 'wrong_music'));

alter table public.venue_reports
drop constraint if exists venue_reports_shape_check;

alter table public.venue_reports
add constraint venue_reports_shape_check
check (
  (reason = 'missing_venue' and venue_id is null)
  or (reason <> 'missing_venue' and venue_id is not null)
);

alter table public.venue_reports
drop constraint if exists venue_reports_details_length_check;

alter table public.venue_reports
add constraint venue_reports_details_length_check
check (details is null or char_length(btrim(details)) <= 1000);

create or replace function public.submit_venue_report(
  p_venue_id uuid,
  p_reason text,
  p_details text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_reason text := lower(btrim(coalesce(p_reason, '')));
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  v_report_id uuid;
  v_existing_report_id uuid;
begin
  if v_user_id is null then
    raise exception 'A private device session is required';
  end if;

  if v_reason not in ('closed', 'duplicate', 'missing_venue', 'other', 'wrong_address', 'wrong_crowd', 'wrong_hours', 'wrong_music') then
    return jsonb_build_object('ok', false, 'message', 'Unsupported venue report reason.');
  end if;

  if v_details is not null and char_length(v_details) > 1000 then
    return jsonb_build_object('ok', false, 'message', 'Keep report details under 1000 characters.');
  end if;

  if v_reason = 'missing_venue' then
    if p_venue_id is not null then
      return jsonb_build_object('ok', false, 'message', 'A missing-venue report cannot target an existing venue.');
    end if;

    if v_details is null or char_length(v_details) < 5 then
      return jsonb_build_object('ok', false, 'message', 'Add a venue name, address, or area before sending.');
    end if;
  else
    if p_venue_id is null then
      return jsonb_build_object('ok', false, 'message', 'Choose a venue for this report.');
    end if;

    if not exists (
      select 1
      from public.venues
      where id = p_venue_id
        and verification_status in ('needs_verification', 'verified')
    ) then
      raise exception 'Venue is not available';
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('venue-report:' || v_user_id::text, 0)
  );

  select id
  into v_existing_report_id
  from public.venue_reports
  where user_id = v_user_id
    and venue_id is not distinct from p_venue_id
    and reason = v_reason
    and details is not distinct from v_details
    and created_at > now() - interval '5 minutes'
  order by created_at desc
  limit 1;

  if v_existing_report_id is not null then
    return jsonb_build_object(
      'ok', true,
      'message', 'This report was already sent.',
      'report_id', v_existing_report_id,
      'idempotent', true
    );
  end if;

  if exists (
    select 1
    from public.venue_reports
    where user_id = v_user_id
      and created_at > now() - interval '5 minutes'
  ) then
    return jsonb_build_object('ok', false, 'message', 'Report cooldown active. Try again in a few minutes.');
  end if;

  insert into public.venue_reports (user_id, venue_id, reason, details)
  values (v_user_id, p_venue_id, v_reason, v_details)
  returning id into v_report_id;

  return jsonb_build_object(
    'ok', true,
    'message', 'Report sent for private review.',
    'report_id', v_report_id
  );
end;
$$;

revoke execute on function public.submit_venue_report(uuid, text, text) from public;
grant execute on function public.submit_venue_report(uuid, text, text) to authenticated;

drop policy if exists "venue_reports_insert_own" on public.venue_reports;

-- Keep accountless security overrides last so older idempotent setup sections
-- cannot restore legacy account-oriented behavior.
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
  select public.launch_submit_venue_music_report(p_venue_id, p_track_title, p_artist_name, p_report_source);
$$;

revoke execute on function public.submit_venue_music_report(uuid, text, text, public.now_playing_source) from public;
grant execute on function public.submit_venue_music_report(uuid, text, text, public.now_playing_source) to authenticated;

drop policy if exists "venue_music_reports_insert_own" on public.venue_music_reports;

create or replace function public.get_admin_status()
returns boolean
language sql
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and not public.current_user_is_anonymous()
    and exists (select 1 from public.app_admins where user_id = auth.uid());
$$;

-- No later section may restore direct contribution mutation policies.
drop policy if exists "venue_pings_delete_own" on public.venue_pings;
drop policy if exists "manual_checkins_delete_own" on public.manual_checkins;
drop policy if exists "venue_reviews_delete_own" on public.venue_reviews;
drop policy if exists "venue_reports_insert_own" on public.venue_reports;
drop policy if exists "venue_music_reports_insert_own" on public.venue_music_reports;

revoke insert, update, delete on table public.venue_pings, public.manual_checkins,
  public.venue_reviews, public.venue_reports, public.venue_music_reports from anon, authenticated;

revoke insert, update, delete on table public.app_admins, public.admin_venue_signals,
  public.curated_trending_venues from anon, authenticated;

revoke execute on function public.cleanup_dynamic_data() from public, anon, authenticated;
revoke execute on function public.cleanup_review_moderation_data() from public, anon, authenticated;
revoke execute on function public.refresh_crowd_snapshots(integer) from public, anon, authenticated;
revoke execute on function public.refresh_venue_crowd_snapshot(uuid, integer) from public, anon, authenticated;
revoke execute on function public.submit_device_music_report(uuid, text, text, public.now_playing_source) from public, anon, authenticated;
revoke execute on function public.delete_identity_data(uuid) from public, anon, authenticated;
revoke execute on function public.moderate_venue_review(uuid, text, text, text, timestamptz) from public, anon, authenticated;

revoke execute on function public.get_admin_status() from public;
grant execute on function public.get_admin_status() to authenticated;

drop policy if exists "app_admins_select_own" on public.app_admins;
create policy "app_admins_select_own"
on public.app_admins for select
to authenticated
using (not public.current_user_is_anonymous() and auth.uid() = user_id);

drop policy if exists "admin_venue_signals_select_admin" on public.admin_venue_signals;
create policy "admin_venue_signals_select_admin"
on public.admin_venue_signals for select
to authenticated
using (
  not public.current_user_is_anonymous()
  and exists (select 1 from public.app_admins where user_id = auth.uid())
);

drop policy if exists "curated_trending_venues_select_admin" on public.curated_trending_venues;
create policy "curated_trending_venues_select_admin"
on public.curated_trending_venues for select
to authenticated
using (
  not public.current_user_is_anonymous()
  and exists (select 1 from public.app_admins where user_id = auth.uid())
);

drop policy if exists "account_deletion_requests_select_own" on public.account_deletion_requests;
create policy "account_deletion_requests_select_own"
on public.account_deletion_requests for select
to authenticated
using (not public.current_user_is_anonymous() and auth.uid() = user_id);

drop policy if exists "account_deletion_requests_insert_own" on public.account_deletion_requests;
create policy "account_deletion_requests_insert_own"
on public.account_deletion_requests for insert
to authenticated
with check (not public.current_user_is_anonymous() and auth.uid() = user_id and status = 'requested');

drop policy if exists "account_deletion_requests_cancel_own" on public.account_deletion_requests;
create policy "account_deletion_requests_cancel_own"
on public.account_deletion_requests for update
to authenticated
using (not public.current_user_is_anonymous() and auth.uid() = user_id and status = 'requested')
with check (not public.current_user_is_anonymous() and auth.uid() = user_id and status = 'cancelled');

drop policy if exists "data_export_requests_select_own" on public.data_export_requests;
create policy "data_export_requests_select_own"
on public.data_export_requests for select
to authenticated
using (not public.current_user_is_anonymous() and auth.uid() = user_id);

drop policy if exists "data_export_requests_insert_own" on public.data_export_requests;
create policy "data_export_requests_insert_own"
on public.data_export_requests for insert
to authenticated
with check (not public.current_user_is_anonymous() and auth.uid() = user_id and status = 'requested');

drop policy if exists "data_export_requests_cancel_own" on public.data_export_requests;
create policy "data_export_requests_cancel_own"
on public.data_export_requests for update
to authenticated
using (not public.current_user_is_anonymous() and auth.uid() = user_id and status = 'requested')
with check (not public.current_user_is_anonymous() and auth.uid() = user_id and status = 'cancelled');

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
