-- Episode index + automatic free-sample delivery. Run after 002_review_rules.sql.
-- Safe to re-run: every object is created with IF NOT EXISTS / OR REPLACE.
--
-- After running this, load the episodes:
--   python scripts/build_episode_index.py "data/<submission sheet>.csv"
--   then Table Editor -> ots_episodes -> Insert -> Import data from CSV ->
--   data/ots_episodes.csv  (columns already match; imported_at fills itself)
--
-- How a free sample goes out
--   1. Kiosk saves the request (submit_ots_request, unchanged).
--   2. Server calls ots_prepare_sample(token) once: it picks ~50 h of matching
--      episodes, spread across the chosen environment x skill pairs, and
--      returns a random access key. A second call for the same token fails,
--      so the key is only ever handed out once.
--   3. Server emails the visitor a link /d/<token>?k=<key> (Resend), then
--      records the outcome with ots_record_sample_email(). Success moves the
--      request to sample_sent; a failure leaves it "Pending delivery" with the
--      error, so an admin can follow up.
--   4. The download page reads the list with ots_get_delivery(token, key) and
--      asks ots_delivery_file(token, key, episode, purpose) for each file it
--      downloads or plays in the page's player. The server
--      then signs a short-lived R2 link with the read-only key. Each link
--      opens exactly one file until it expires; the bucket stays private and
--      R2 itself is never written.
--
-- Access model (same as 001): anon can call the four functions below and
-- nothing else. Admins read everything through RLS. No table is writable
-- through the API.

-- ---------------------------------------------------------------- episodes

create table if not exists public.ots_episodes (
  episode_id     text primary key,
  bucket         text not null,
  prefix         text not null check (right(prefix, 1) = '/'),  -- episode folder; files are <prefix>Ego/stereo.mp4 etc.
  capture_setup  text not null default 'ego' check (capture_setup in ('ego', 'head_wrist')),
  domain         text not null,
  skill          text not null,
  difficulty     text not null check (difficulty in ('easy', 'medium', 'hard')),
  duration_s     integer not null check (duration_s > 0),
  stereo_bytes   bigint check (stereo_bytes is null or stereo_bytes >= 0),
  task_name      text,
  location_name  text,
  environment_l2 text,
  environment_l3 text,
  imported_at    timestamptz not null default now()
);

create index if not exists ots_episodes_match_idx on public.ots_episodes (capture_setup, domain, skill, difficulty);

-- ---------------------------------------------------------------- deliveries

create table if not exists public.ots_deliveries (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null unique references public.ots_requests (id) on delete cascade,
  -- 64 hex chars from two v4 UUIDs (gen_random_uuid is core Postgres, no extension schema needed).
  access_key    text not null unique
                default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  status        text not null default 'prepared' check (status in ('prepared', 'emailed', 'failed')),
  episode_count integer not null default 0,
  duration_s    bigint not null default 0,
  total_bytes   bigint,
  expires_at    timestamptz not null default now() + interval '7 days',
  email_id      text,
  error         text,
  created_at    timestamptz not null default now(),
  emailed_at    timestamptz
);

create table if not exists public.ots_delivery_items (
  delivery_id        uuid not null references public.ots_deliveries (id) on delete cascade,
  episode_id         text not null references public.ots_episodes (episode_id),
  position           integer not null,
  download_count     integer not null default 0,
  last_downloaded_at timestamptz,
  play_count         integer not null default 0,  -- watched in the browser (streamed, not downloaded)
  last_played_at     timestamptz,
  primary key (delivery_id, episode_id)
);
-- For a database that ran an earlier version of this file.
alter table public.ots_delivery_items add column if not exists play_count integer not null default 0;
alter table public.ots_delivery_items add column if not exists last_played_at timestamptz;

alter table public.ots_episodes       enable row level security;
alter table public.ots_deliveries     enable row level security;
alter table public.ots_delivery_items enable row level security;

revoke insert, update, delete, truncate on public.ots_episodes, public.ots_deliveries, public.ots_delivery_items
  from anon, authenticated;
revoke select on public.ots_episodes, public.ots_deliveries, public.ots_delivery_items from anon;

drop policy if exists "admins read episodes" on public.ots_episodes;
create policy "admins read episodes" on public.ots_episodes
  for select to authenticated using (public.is_ots_admin());

drop policy if exists "admins read deliveries" on public.ots_deliveries;
create policy "admins read deliveries" on public.ots_deliveries
  for select to authenticated using (public.is_ots_admin());

drop policy if exists "admins read delivery items" on public.ots_delivery_items;
create policy "admins read delivery items" on public.ots_delivery_items
  for select to authenticated using (public.is_ots_admin());

-- ---------------------------------------------------------------- 2. pick the sample

create or replace function public.ots_prepare_sample(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_target_s constant integer := 50 * 3600;  -- free sample size: 50 h, or everything that matches if less
  r public.ots_requests;
  d public.ots_deliveries;
begin
  select * into r from public.ots_requests where token = p_token for update;
  if not found or r.kind <> 'sample' then
    raise exception 'No sample request %.', p_token using errcode = 'P0002';
  end if;
  -- One shot, right after submit: the key is never handed out twice.
  if r.status <> 'submitted' or r.created_at < now() - interval '10 minutes'
     or exists (select 1 from public.ots_deliveries where request_id = r.id) then
    raise exception 'Sample % is already being handled.', p_token using errcode = '22023';
  end if;

  insert into public.ots_deliveries (request_id) values (r.id) returning * into d;
  -- Samples ship the stereo MP4 only (not MCAP); say so on the request.
  update public.ots_requests set delivery_format = 'Stereo MP4 (H.265)', updated_at = now() where id = r.id;

  -- Round-robin across environment x skill pairs (random order inside each),
  -- so the sample is a mix rather than 50 h of the biggest pair. Stops at the
  -- first episode that reaches the target, so it can run over by one episode.
  insert into public.ots_delivery_items (delivery_id, episode_id, position)
  select d.id, episode_id, row_number() over (order by rn, k)
    from (
      select episode_id, rn, k,
             sum(duration_s) over (order by rn, k rows unbounded preceding) as running_s,
             duration_s
        from (
          select e.episode_id, e.duration_s, random() as k,
                 row_number() over (partition by e.domain, e.skill order by random()) as rn
            from public.ots_episodes e
           where e.capture_setup = r.capture_setup
             and e.domain = any (r.environments)
             and (cardinality(r.skills) = 0 or e.skill = any (r.skills))
             and (cardinality(r.difficulties) = 0 or e.difficulty = any (r.difficulties))
        ) pool
    ) ranked
   where running_s - duration_s < c_target_s;

  update public.ots_deliveries o
     set episode_count = s.n,
         duration_s    = s.secs,
         total_bytes   = s.bytes,
         status        = case when s.n = 0 then 'failed' else o.status end,
         error         = case when s.n = 0 then 'No episodes match this selection.' end
    from (
      select count(*)::int as n, coalesce(sum(e.duration_s), 0) as secs, sum(e.stereo_bytes) as bytes
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

-- ---------------------------------------------------------------- 3. record the email

create or replace function public.ots_record_sample_email(
  p_token    text,
  p_key      text,
  p_email_id text default null,
  p_error    text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.ots_requests;
  d public.ots_deliveries;
begin
  select o.* into d
    from public.ots_deliveries o
    join public.ots_requests q on q.id = o.request_id
   where q.token = p_token and o.access_key = p_key
   for update of o;
  if not found or d.status <> 'prepared' then
    raise exception 'Nothing to record for %.', p_token using errcode = '22023';
  end if;

  if p_error is not null then
    update public.ots_deliveries set status = 'failed', error = left(p_error, 500) where id = d.id;
    return;
  end if;

  update public.ots_deliveries
     set status = 'emailed', email_id = left(p_email_id, 100), emailed_at = now(), error = null
   where id = d.id;

  update public.ots_requests set status = 'sample_sent', updated_at = now()
   where id = d.request_id and status = 'submitted'
  returning * into r;

  if found then
    insert into public.ots_request_events (request_id, from_status, to_status, note, actor_email)
    values (r.id, 'submitted', 'sample_sent',
            format('Emailed automatically: %s episodes, %s h', d.episode_count, round(d.duration_s / 3600.0, 1)),
            'system');
  end if;
end;
$$;

-- ---------------------------------------------------------------- 4. download page

create or replace function public.ots_get_delivery(p_token text, p_key text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'token',         q.token,
           'full_name',     q.full_name,
           'episode_count', o.episode_count,
           'hours',         round(o.duration_s / 3600.0, 1),
           'total_bytes',   o.total_bytes,
           'expires_at',    o.expires_at,
           'expired',       o.expires_at < now(),
           'items', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'episode_id', e.episode_id, 'domain', e.domain, 'skill', e.skill,
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

-- Where one file lives, for the server to sign. Null when the key is wrong,
-- the link has expired or the episode is not in this delivery.
-- p_purpose 'download' or 'play' only decides which counter goes up.
drop function if exists public.ots_delivery_file(text, text, text);  -- earlier 3-argument version

create or replace function public.ots_delivery_file(p_token text, p_key text, p_episode_id text, p_purpose text default 'download')
returns table (bucket text, prefix text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery uuid;
  v_play     boolean := p_purpose = 'play';
begin
  select o.id into v_delivery
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

  return query select e.bucket, e.prefix from public.ots_episodes e where e.episode_id = p_episode_id;
end;
$$;

revoke all on function public.ots_prepare_sample(text) from public;
revoke all on function public.ots_record_sample_email(text, text, text, text) from public;
revoke all on function public.ots_get_delivery(text, text) from public;
revoke all on function public.ots_delivery_file(text, text, text, text) from public;

grant execute on function public.ots_prepare_sample(text) to anon, authenticated;
grant execute on function public.ots_record_sample_email(text, text, text, text) to anon, authenticated;
grant execute on function public.ots_get_delivery(text, text) to anon, authenticated;
grant execute on function public.ots_delivery_file(text, text, text, text) to anon, authenticated;

-- Make the API see new/changed functions immediately (otherwise PostgREST can
-- keep serving its old schema cache and calls fail with PGRST202).
notify pgrst, 'reload schema';
