-- Run after supabase/schema.sql.
-- Schedules crowd label aggregation every 2 minutes.

create extension if not exists pg_cron;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in select jobid from cron.job where jobname = 'mesta-refresh-crowd-snapshots'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end $$;

select cron.schedule(
  'mesta-refresh-crowd-snapshots',
  '*/2 * * * *',
  $$select public.refresh_crowd_snapshots(90);$$
);

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in select jobid from cron.job where jobname = 'mesta-cleanup-dynamic-data'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end $$;

select cron.schedule(
  'mesta-cleanup-dynamic-data',
  '17 * * * *',
  $$select public.cleanup_dynamic_data();$$
);

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in select jobid from cron.job where jobname = 'riento-cleanup-review-moderation-data'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end $$;

select cron.schedule(
  'riento-cleanup-review-moderation-data',
  '47 * * * *',
  $$select public.cleanup_review_moderation_data();$$
);

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in select jobid from cron.job where jobname = 'riento-cleanup-launch-rate-buckets'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end $$;

select cron.schedule(
  'riento-cleanup-launch-rate-buckets',
  '37 * * * *',
  $$select public.cleanup_launch_rate_buckets();$$
);

drop function if exists public.get_launch_maintenance_status();
create function public.get_launch_maintenance_status()
returns table (
  expected_job_count integer,
  active_job_count integer,
  configured_job_count integer,
  failing_job_count integer
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with expected(jobname, schedule, command) as (
    values
      ('mesta-refresh-crowd-snapshots'::text, '*/2 * * * *'::text, 'select public.refresh_crowd_snapshots(90);'::text),
      ('mesta-cleanup-dynamic-data', '17 * * * *', 'select public.cleanup_dynamic_data();'),
      ('riento-cleanup-review-moderation-data', '47 * * * *', 'select public.cleanup_review_moderation_data();'),
      ('riento-cleanup-launch-rate-buckets', '37 * * * *', 'select public.cleanup_launch_rate_buckets();')
  ),
  jobs as (
    select scheduled.*, expected.schedule as expected_schedule, expected.command as expected_command
    from expected
    left join cron.job scheduled on scheduled.jobname = expected.jobname
  ),
  latest_runs as (
    select jobs.jobid, latest.status
    from jobs
    left join lateral (
      select details.status
      from cron.job_run_details details
      where details.jobid = jobs.jobid
      order by details.start_time desc
      limit 1
    ) latest on true
  )
  select
    4,
    count(distinct jobs.jobname) filter (where jobs.active)::integer,
    count(distinct jobs.jobname) filter (
      where jobs.active
        and jobs.schedule = jobs.expected_schedule
        and btrim(jobs.command) = jobs.expected_command
    )::integer,
    count(*) filter (where latest_runs.status = 'failed')::integer
  from jobs
  left join latest_runs on latest_runs.jobid = jobs.jobid;
$$;

revoke execute on function public.get_launch_maintenance_status() from public;
grant execute on function public.get_launch_maintenance_status() to anon, authenticated;
