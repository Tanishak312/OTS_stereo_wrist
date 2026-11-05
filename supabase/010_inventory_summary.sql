-- Kiosk totals from a summary table instead of scanning every episode.
-- Run after 009_head_wrist.sql, BEFORE importing a new episode CSV. Safe to re-run.
--
-- Why: ots_inventory() re-counted the whole of ots_episodes on every cache miss.
-- anon's statement timeout is ~3 s; at 53k rows the call took 0.8 s, 2.2 s once,
-- and timed out during an import, which dropped the kiosk to the datasheet
-- estimate. Batch 6 takes the table to 64k rows.
--
-- How: triggers on ots_episodes keep two small tables up to date, row by row, so
-- nobody has to remember a refresh and an import shows on the kiosk by itself
-- (within its 5-minute cache). ots_inventory() returns the same JSON as before.
--
-- Tasks are now counted by name without punctuation or case, so batch 6's
-- "Applying labels – Packaging Area" and the older
-- "applying_labels_packaging_area" count as one task.

create table if not exists public.ots_inventory_cells (
  capture_setup text not null,
  domain        text not null,
  skill         text not null,
  difficulty    text not null default '',  -- '' = not graded (head + wrist)
  episodes      bigint not null,
  seconds       bigint not null,
  bytes         bigint not null,
  primary key (capture_setup, domain, skill, difficulty)
);

create table if not exists public.ots_inventory_tasks (
  task     text primary key,
  episodes bigint not null
);

-- Aggregates only, but nothing reads them directly: ots_inventory() does.
alter table public.ots_inventory_cells enable row level security;
alter table public.ots_inventory_tasks enable row level security;
revoke all on public.ots_inventory_cells, public.ots_inventory_tasks from public, anon, authenticated;

create or replace function public.ots_task_key(p_name text)
returns text
language sql
immutable
as $$
  select nullif(btrim(regexp_replace(lower(p_name), '[^a-z]+', ' ', 'g')), '');
$$;

-- Adds (p_sign = 1) or removes (-1) one episode from both summaries.
create or replace function public.ots_inventory_apply(e public.ots_episodes, p_sign integer)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_task text := public.ots_task_key(e.task_name);
begin
  insert into public.ots_inventory_cells as c (capture_setup, domain, skill, difficulty, episodes, seconds, bytes)
  values (e.capture_setup, e.domain, e.skill, coalesce(e.difficulty, ''), p_sign, p_sign * e.duration_s, p_sign * coalesce(e.stereo_bytes, 0))
  on conflict (capture_setup, domain, skill, difficulty) do update
    set episodes = c.episodes + excluded.episodes,
        seconds  = c.seconds + excluded.seconds,
        bytes    = c.bytes + excluded.bytes;

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

-- Security definer so an import works under whichever role runs it.
create or replace function public.ots_inventory_on_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP <> 'INSERT' then
    perform public.ots_inventory_apply(old, -1);
  end if;
  if TG_OP <> 'DELETE' then
    perform public.ots_inventory_apply(new, 1);
  end if;
  return null;
end;
$$;

create or replace function public.ots_inventory_on_truncate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  truncate public.ots_inventory_cells, public.ots_inventory_tasks;
  return null;
end;
$$;

revoke all on function public.ots_inventory_apply(public.ots_episodes, integer) from public, anon, authenticated;
revoke all on function public.ots_inventory_on_row() from public, anon, authenticated;
revoke all on function public.ots_inventory_on_truncate() from public, anon, authenticated;

-- Triggers and the first fill go together: the lock holds off any import, so no
-- row is counted twice or missed.
begin;

lock table public.ots_episodes in share row exclusive mode;

drop trigger if exists ots_inventory_row on public.ots_episodes;
create trigger ots_inventory_row
  after insert or update or delete on public.ots_episodes
  for each row execute function public.ots_inventory_on_row();

drop trigger if exists ots_inventory_truncate on public.ots_episodes;
create trigger ots_inventory_truncate
  after truncate on public.ots_episodes
  for each statement execute function public.ots_inventory_on_truncate();

truncate public.ots_inventory_cells, public.ots_inventory_tasks;

insert into public.ots_inventory_cells (capture_setup, domain, skill, difficulty, episodes, seconds, bytes)
select capture_setup, domain, skill, coalesce(difficulty, ''),
       count(*), sum(duration_s), coalesce(sum(stereo_bytes), 0)
  from public.ots_episodes
 group by 1, 2, 3, 4;

insert into public.ots_inventory_tasks (task, episodes)
select public.ots_task_key(task_name), count(*)
  from public.ots_episodes
 where public.ots_task_key(task_name) is not null
 group by 1;

commit;

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
      select jsonb_agg(jsonb_build_array(capture_setup, domain, skill, nullif(difficulty, ''), episodes, seconds, bytes))
        from public.ots_inventory_cells), '[]'::jsonb),
    'tasks', (select count(*) from public.ots_inventory_tasks)
  );
$$;

revoke all on function public.ots_inventory() from public;
grant execute on function public.ots_inventory() to anon, authenticated;

notify pgrst, 'reload schema';

-- Check it, then expect the same numbers on the kiosk:
--   select capture_setup, sum(episodes) episodes, round(sum(seconds) / 3600.0, 1) hours
--     from public.ots_inventory_cells group by 1;
