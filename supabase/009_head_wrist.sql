-- Head + wrist (Axis) recordings in the catalogue.
-- Run after 008_s3_transfer_jobs.sql, BEFORE importing data/ots_episodes_axis.csv.
-- Safe to re-run. No data is changed or deleted.
--
-- 1. ots_episodes.difficulty may be empty: Axis recordings aren't graded.
--    The kiosk hides the difficulty filter for head + wrist.
-- 2. The functions behind the download page, the episode ZIP / link list and
--    the S3 copy also return capture_setup, so they know which files an
--    episode has (one stereo video + MCAP + calibration, or head + two wrist
--    videos). Their return types change, so they're dropped and recreated.
-- 3. delivery_format on a request says what it actually ships.

-- ---------------------------------------------------------------- 1. difficulty

alter table public.ots_episodes alter column difficulty drop not null;
-- The existing check (difficulty in ('easy','medium','hard')) already passes NULL.

-- ---------------------------------------------------------------- 2. capture_setup in the delivery functions

-- Download page (same return type: jsonb; only the contents gain capture_setup).
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
                      'stereo_bytes', e.stereo_bytes, 'task_name', e.task_name)
                    order by e.domain, e.skill, i.position)
               from public.ots_delivery_items i
               join public.ots_episodes e using (episode_id)
              where i.delivery_id = o.id), '[]'::jsonb))
    from public.ots_deliveries o
    join public.ots_requests q on q.id = o.request_id
   where q.token = p_token and o.access_key = p_key and o.episode_count > 0;
$$;

-- One file of one episode (counts a download or play).
drop function if exists public.ots_delivery_file(text, text, text, text);

create function public.ots_delivery_file(p_token text, p_key text, p_episode_id text, p_purpose text default 'download')
returns table (bucket text, prefix text, capture_setup text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery uuid;
  v_expires  timestamptz;
  v_play     boolean := p_purpose = 'play';
begin
  select o.id, o.expires_at into v_delivery, v_expires
    from public.ots_deliveries o
    join public.ots_requests q on q.id = o.request_id
   where q.token = p_token and o.access_key = p_key and o.expires_at >= now();
  if v_delivery is null then
    return;
  end if;

  update public.ots_delivery_items
     set download_count     = download_count + (not v_play)::int,
         last_downloaded_at = case when v_play then last_downloaded_at else now() end,
         play_count         = play_count + v_play::int,
         last_played_at     = case when v_play then now() else last_played_at end
   where delivery_id = v_delivery and episode_id = p_episode_id;
  if not found then
    return;
  end if;

  return query select e.bucket, e.prefix, e.capture_setup, v_expires from public.ots_episodes e where e.episode_id = p_episode_id;
end;
$$;

-- Every episode of a delivery, for the link list, manifest and episode ZIP.
drop function if exists public.ots_delivery_episodes(text, text);

create function public.ots_delivery_episodes(p_token text, p_key text)
returns table (
  episode_id    text,
  bucket        text,
  prefix        text,
  capture_setup text,
  domain        text,
  skill         text,
  difficulty    text,
  duration_s    integer,
  task_name     text,
  kind          text,
  expires_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select e.episode_id, e.bucket, e.prefix, e.capture_setup, e.domain, e.skill, e.difficulty, e.duration_s, e.task_name,
         q.kind, o.expires_at
    from public.ots_deliveries o
    join public.ots_requests q on q.id = o.request_id
    join public.ots_delivery_items i on i.delivery_id = o.id
    join public.ots_episodes e on e.episode_id = i.episode_id
   where q.token = p_token and o.access_key = p_key and o.expires_at >= now()
   order by e.domain, e.skill, i.position;
$$;

-- The episodes of a running S3 copy (worker only).
drop function if exists public.ots_transfer_episodes(uuid);

create function public.ots_transfer_episodes(p_transfer_id uuid)
returns table (
  episode_id text, bucket text, prefix text, capture_setup text, domain text, skill text,
  difficulty text, duration_s integer, task_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_ots_worker() then
    raise exception 'not an OTS worker' using errcode = '42501';
  end if;
  return query
    select e.episode_id, e.bucket, e.prefix, e.capture_setup, e.domain, e.skill, e.difficulty, e.duration_s, e.task_name
      from public.ots_transfers t
      join public.ots_deliveries o on o.request_id = t.request_id
      join public.ots_delivery_items i on i.delivery_id = o.id
      join public.ots_episodes e on e.episode_id = i.episode_id
     where t.id = p_transfer_id and t.status = 'running'
     order by i.position;
end;
$$;

revoke all on function public.ots_delivery_file(text, text, text, text) from public;
revoke all on function public.ots_delivery_episodes(text, text) from public;
revoke all on function public.ots_transfer_episodes(uuid) from public, anon;
grant execute on function public.ots_delivery_file(text, text, text, text) to anon, authenticated;
grant execute on function public.ots_delivery_episodes(text, text) to anon, authenticated;
grant execute on function public.ots_transfer_episodes(uuid) to authenticated;

-- ---------------------------------------------------------------- 3. delivery_format

-- ots_prepare_sample / ots_prepare_dataset write 'Stereo MP4 (H.265)', which is
-- wrong for head + wrist. Correct it on the way in rather than copying both
-- functions here.
create or replace function public.ots_requests_delivery_format()
returns trigger
language plpgsql
as $$
begin
  if new.capture_setup = 'head_wrist' then
    new.delivery_format := 'Head + left/right wrist MP4s (synced)';
  end if;
  return new;
end;
$$;

drop trigger if exists ots_requests_delivery_format on public.ots_requests;
create trigger ots_requests_delivery_format
  before insert or update of delivery_format on public.ots_requests
  for each row execute function public.ots_requests_delivery_format();

notify pgrst, 'reload schema';
