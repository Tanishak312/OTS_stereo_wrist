-- MCAP in free samples too, the same as a full dataset.
-- Run after 011_mcap_delivery.sql (012 may come before or after), BEFORE deploying
-- the code that uses it. Safe to re-run. Nothing here touches R2.
--
-- ots_prepare_sample() takes p_with_mcap, the app's OFFER_MCAP, so the delivery's
-- total_bytes and the request's delivery_format say what really ships. It picks
-- episodes exactly as before. Samples already sent keep their numbers.

drop function if exists public.ots_prepare_sample(text);

create or replace function public.ots_prepare_sample(p_token text, p_with_mcap boolean default false)
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
  -- The 009 trigger corrects this for head + wrist, which has no MCAP.
  update public.ots_requests
     set delivery_format = case when p_with_mcap then 'Stereo MP4 (H.265) + MCAP' else 'Stereo MP4 (H.265)' end,
         updated_at = now()
   where id = r.id;

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

revoke all on function public.ots_prepare_sample(text, boolean) from public;
grant execute on function public.ots_prepare_sample(text, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
