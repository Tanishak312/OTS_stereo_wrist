-- Full-dataset delivery on approval, and links valid for the whole delivery.
-- Run after 003_episodes_delivery.sql. Safe to re-run.
--
-- What changes
--   * When an admin approves a dataset request, the app calls
--     ots_prepare_dataset(token) (admins only): it takes EVERY episode that
--     matches the request (no 50 h cap), creates a delivery with its own access
--     key, and the app emails the customer the same kind of page a sample gets:
--     watch in the browser or download, stereo MP4.
--   * ots_record_delivery_email() records the email for either kind. A sample
--     moves to sample_sent; an approved dataset stays approved and gets a
--     history entry. ots_record_sample_email() now just calls it.
--   * ots_delivery_file() also returns the delivery's expiry, so the app signs
--     each R2 link until the delivery itself expires (was a fixed 6 h): a player
--     left open, or a long download, keeps working for the full 7 days.
--   * ots_get_delivery() also returns the request kind, for the page's wording.
-- Nothing here touches R2, and existing deliveries keep their keys and expiry.

-- ---------------------------------------------------------------- prepare a dataset

create or replace function public.ots_prepare_dataset(p_token text)
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
  update public.ots_requests set delivery_format = 'Stereo MP4 (H.265)', updated_at = now() where id = r.id;

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

-- ---------------------------------------------------------------- record the email (both kinds)

create or replace function public.ots_record_delivery_email(
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
  q public.ots_requests;
  d public.ots_deliveries;
  v_summary text;
begin
  select o.* into d
    from public.ots_deliveries o
    join public.ots_requests rq on rq.id = o.request_id
   where rq.token = p_token and o.access_key = p_key
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

  select * into q from public.ots_requests where id = d.request_id for update;
  v_summary := format('%s episodes, %s h', d.episode_count, round(d.duration_s / 3600.0, 1));

  if q.kind = 'sample' and q.status = 'submitted' then
    update public.ots_requests set status = 'sample_sent', updated_at = now() where id = q.id;
    insert into public.ots_request_events (request_id, from_status, to_status, note, actor_email)
    values (q.id, 'submitted', 'sample_sent', 'Emailed automatically: ' || v_summary, 'system');
  elsif q.kind = 'dataset' then
    -- Status stays approved; the history shows when the link went out.
    insert into public.ots_request_events (request_id, from_status, to_status, note, actor_email)
    values (q.id, null, q.status, 'Download link emailed: ' || v_summary, 'system');
  end if;
end;
$$;

-- Kept for the sample code path; same behaviour as before, one implementation.
create or replace function public.ots_record_sample_email(
  p_token    text,
  p_key      text,
  p_email_id text default null,
  p_error    text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  select public.ots_record_delivery_email(p_token, p_key, p_email_id, p_error);
$$;

-- ---------------------------------------------------------------- page + files

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

-- Return type gains expires_at, which CREATE OR REPLACE can't change in place.
drop function if exists public.ots_delivery_file(text, text, text, text);
drop function if exists public.ots_delivery_file(text, text, text);

create function public.ots_delivery_file(p_token text, p_key text, p_episode_id text, p_purpose text default 'download')
returns table (bucket text, prefix text, expires_at timestamptz)
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

  return query select e.bucket, e.prefix, v_expires from public.ots_episodes e where e.episode_id = p_episode_id;
end;
$$;

revoke all on function public.ots_prepare_dataset(text) from public, anon;
revoke all on function public.ots_record_delivery_email(text, text, text, text) from public;
revoke all on function public.ots_delivery_file(text, text, text, text) from public;

grant execute on function public.ots_prepare_dataset(text) to authenticated;  -- admin check inside
grant execute on function public.ots_record_delivery_email(text, text, text, text) to anon, authenticated;
grant execute on function public.ots_delivery_file(text, text, text, text) to anon, authenticated;

-- Make the API see the changed functions now, not after its cache refreshes.
notify pgrst, 'reload schema';
