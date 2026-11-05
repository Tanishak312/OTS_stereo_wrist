-- Live catalogue numbers for the kiosk, straight from the episode index.
-- Run after 004_dataset_delivery.sql. Safe to re-run.
--
-- ots_inventory() returns one row per capture setup x environment x skill x
-- difficulty with its episode count, seconds and stereo bytes, so the kiosk
-- shows the real hours for any combination instead of an estimate from the
-- datasheet's totals (e.g. Food & Beverage x Tool use: 5.5 h, not ~135 h).
-- Aggregates only: no paths, episode ids or people, so anon may call it.
-- Re-importing ots_episodes updates the kiosk within ~5 minutes (its cache).

create or replace function public.ots_inventory()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    -- [setup, domain, skill, difficulty, episodes, seconds, bytes]; arrays keep the payload small.
    'cells', coalesce((
      select jsonb_agg(jsonb_build_array(capture_setup, domain, skill, difficulty, n, secs, bytes))
        from (
          select capture_setup, domain, skill, difficulty,
                 count(*) as n, sum(duration_s) as secs, coalesce(sum(stereo_bytes), 0) as bytes
            from public.ots_episodes
           group by 1, 2, 3, 4
        ) c), '[]'::jsonb),
    'tasks', (select count(distinct lower(task_name)) from public.ots_episodes)
  );
$$;

revoke all on function public.ots_inventory() from public;
grant execute on function public.ots_inventory() to anon, authenticated;

-- The episode sheet has more environments (24) than the v3 datasheet (21),
-- and a request may now pick any of them.
alter table public.ots_requests drop constraint if exists ots_requests_environments_check;
alter table public.ots_requests add constraint ots_requests_environments_check
  check (cardinality(environments) between 1 and 40
         and array_to_string(environments, ',') ~ '^[a-z-]+(,[a-z-]+)*$');

notify pgrst, 'reload schema';
