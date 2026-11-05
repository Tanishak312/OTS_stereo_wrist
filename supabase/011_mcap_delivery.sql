-- MCAP in full-dataset deliveries, with real sizes.
-- Run after 010_inventory_summary.sql, BEFORE deploying the code that uses it.
-- Safe to re-run. Changes no episode, delivery or request; nothing here touches R2.
--
-- 1. ots_episodes.mcap_bytes, and an MCAP total per inventory cell, so the kiosk's
--    download size counts the MCAP that goes out.
-- 2. ots_prepare_dataset() takes p_with_mcap, the app's OFFER_MCAP: the delivery's
--    total_bytes and the request's delivery_format then say what really ships.
--    Free samples get the same in 013_sample_mcap.sql.
-- 3. ots_get_delivery() returns each episode's mcap_bytes for the download page.
--
-- Next: import data/ots_episode_mcap_sizes.csv into ots_episode_mcap_sizes, then
-- run 012_apply_mcap_sizes.sql.

alter table public.ots_episodes
  add column if not exists mcap_bytes bigint check (mcap_bytes is null or mcap_bytes >= 0);

alter table public.ots_inventory_cells
  add column if not exists mcap_bytes bigint not null default 0;

-- Staging table for the size import; 012 moves the sizes across and empties it.
create table if not exists public.ots_episode_mcap_sizes (
  episode_id text primary key,
  mcap_bytes bigint not null
);
alter table public.ots_episode_mcap_sizes enable row level security;
revoke all on public.ots_episode_mcap_sizes from public, anon, authenticated;

-- ---------------------------------------------------------------- inventory

create or replace function public.ots_inventory_apply(e public.ots_episodes, p_sign integer)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_task text := public.ots_task_key(e.task_name);
begin
  insert into public.ots_inventory_cells as c (capture_setup, domain, skill, difficulty, episodes, seconds, bytes, mcap_bytes)
  values (e.capture_setup, e.domain, e.skill, coalesce(e.difficulty, ''), p_sign, p_sign * e.duration_s,
          p_sign * coalesce(e.stereo_bytes, 0), p_sign * coalesce(e.mcap_bytes, 0))
  on conflict (capture_setup, domain, skill, difficulty) do update
    set episodes   = c.episodes + excluded.episodes,
        seconds    = c.seconds + excluded.seconds,
        bytes      = c.bytes + excluded.bytes,
        mcap_bytes = c.mcap_bytes + excluded.mcap_bytes;

  delete from public.ots_inventory_cells
   where capture_setup = e.capture_setup and domain = e.domain and skill = e.skill
     and difficulty = coalesce(e.difficulty, '') and episodes <= 0;

  if v_task is not null then
    insert into public.ots_inventory_tasks as t (task, episodes)
    values (v_task, p_sign)
    on conflict (task) do update set episodes = t.episodes + excluded.episodes;

    delete from public.ots_inventory_tasks where task = v_task and episodes <= 0;
  end if;
end;
$$;

-- Recounts both summaries from ots_episodes. Normally the triggers keep them
-- right; this is for a bulk change that runs with the trigger off (012).
create or replace function public.ots_inventory_rebuild()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  lock table public.ots_episodes in share row exclusive mode;

  truncate public.ots_inventory_cells, public.ots_inventory_tasks;

  insert into public.ots_inventory_cells (capture_setup, domain, skill, difficulty, episodes, seconds, bytes, mcap_bytes)
  select capture_setup, domain, skill, coalesce(difficulty, ''),
         count(*), sum(duration_s), coalesce(sum(stereo_bytes), 0), coalesce(sum(mcap_bytes), 0)
    from public.ots_episodes
   group by 1, 2, 3, 4;

  insert into public.ots_inventory_tasks (task, episodes)
  select public.ots_task_key(task_name), count(*)
    from public.ots_episodes
   where public.ots_task_key(task_name) is not null
   group by 1;
end;
$$;

revoke all on function public.ots_inventory_rebuild() from public, anon, authenticated;

-- Same JSON as before, with the MCAP bytes as an eighth value per cell.
create or replace function public.ots_inventory()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    -- [setup, domain, skill, difficulty, episodes, seconds, bytes, mcap bytes]; arrays keep the payload small.
    'cells', coalesce((
      select jsonb_agg(jsonb_build_array(capture_setup, domain, skill, nullif(difficulty, ''), episodes, seconds, bytes, mcap_bytes))
        from public.ots_inventory_cells), '[]'::jsonb),
    'tasks', (select count(*) from public.ots_inventory_tasks)
  );
$$;

revoke all on function public.ots_inventory() from public;
grant execute on function public.ots_inventory() to anon, authenticated;

-- ---------------------------------------------------------------- dataset delivery

drop function if exists public.ots_prepare_dataset(text);

create or replace function public.ots_prepare_dataset(p_token text, p_with_mcap boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.ots_requests;
  d public.ots_deliveries;
begin
  if not public.is_ots_admin() then
    raise exception 'Only OTS admins can prepare a dataset delivery.' using errcode = '42501';
  end if;

  select * into r from public.ots_requests where token = p_token for update;
  if not found or r.kind <> 'dataset' then
    raise exception 'No dataset request %.', p_token using errcode = 'P0002';
  end if;
  if r.status <> 'approved' then
    raise exception 'Dataset % is % — approve it first.', p_token, r.status using errcode = '22023';
  end if;
  -- One delivery (and one key) per request.
  if exists (select 1 from public.ots_deliveries where request_id = r.id) then
    raise exception 'Dataset % already has a delivery.', p_token using errcode = '22023';
  end if;

  insert into public.ots_deliveries (request_id) values (r.id) returning * into d;
  -- The 009 trigger corrects this for head + wrist, which has no MCAP.
  update public.ots_requests
     set delivery_format = case when p_with_mcap then 'Stereo MP4 (H.265) + MCAP' else 'Stereo MP4 (H.265)' end,
         updated_at = now()
   where id = r.id;

  -- Everything that matches, listed by environment then skill.
  insert into public.ots_delivery_items (delivery_id, episode_id, position)
  select d.id, e.episode_id, row_number() over (order by e.domain, e.skill, e.episode_id)
    from public.ots_episodes e
   where e.capture_setup = r.capture_setup
     and e.domain = any (r.environments)
     and (cardinality(r.skills) = 0 or e.skill = any (r.skills))
     and (cardinality(r.difficulties) = 0 or e.difficulty = any (r.difficulties));

  update public.ots_deliveries o
     set episode_count = s.n,
         duration_s    = s.secs,
         -- NULL for head + wrist (no sizes in the index): the page estimates from GB per hour.
         total_bytes   = s.bytes + case when p_with_mcap then s.mcap else 0 end,
         status        = case when s.n = 0 then 'failed' else o.status end,
         error         = case when s.n = 0 then 'No episodes match this selection.' end
    from (
      select count(*)::int as n, coalesce(sum(e.duration_s), 0) as secs,
             sum(e.stereo_bytes) as bytes, coalesce(sum(e.mcap_bytes), 0) as mcap
        from public.ots_delivery_items i
        join public.ots_episodes e using (episode_id)
       where i.delivery_id = d.id
    ) s
   where o.id = d.id
  returning o.* into d;

  return jsonb_build_object(
    'access_key',    d.access_key,
    'episode_count', d.episode_count,
    'hours',         round(d.duration_s / 3600.0, 1),
    'total_bytes',   d.total_bytes,
    'expires_at',    d.expires_at
  );
end;
$$;

revoke all on function public.ots_prepare_dataset(text, boolean) from public, anon;
grant execute on function public.ots_prepare_dataset(text, boolean) to authenticated;  -- admin check inside

-- Download page (return type unchanged; each item gains mcap_bytes).
create or replace function public.ots_get_delivery(p_token text, p_key text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'token',         q.token,
           'kind',          q.kind,
           'capture_setup', q.capture_setup,
           'full_name',     q.full_name,
           'episode_count', o.episode_count,
           'hours',         round(o.duration_s / 3600.0, 1),
           'total_bytes',   o.total_bytes,
           'expires_at',    o.expires_at,
           'expired',       o.expires_at < now(),
           'items', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'episode_id', e.episode_id, 'capture_setup', e.capture_setup, 'domain', e.domain, 'skill', e.skill,
                      'difficulty', e.difficulty, 'duration_s', e.duration_s,
                      'stereo_bytes', e.stereo_bytes, 'mcap_bytes', e.mcap_bytes, 'task_name', e.task_name)
                    order by e.domain, e.skill, i.position)
               from public.ots_delivery_items i
               join public.ots_episodes e using (episode_id)
              where i.delivery_id = o.id), '[]'::jsonb))
    from public.ots_deliveries o
    join public.ots_requests q on q.id = o.request_id
   where q.token = p_token and o.access_key = p_key and o.episode_count > 0;
$$;

notify pgrst, 'reload schema';
