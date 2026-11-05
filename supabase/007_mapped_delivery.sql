-- Mapped delivery: one folder per episode (video, MCAP, calibration/,
-- episode.json) plus a manifest.csv, for the "Download everything" list, the
-- one-click episode ZIP and the copy into a customer's S3 bucket.
-- Run after 006_s3_delivery.sql. Safe to re-run. Adds one read-only function;
-- no table changes.
--
-- ots_delivery_episodes() gives the app server every episode of a delivery with
-- the metadata and R2 folder it needs to build that layout. Same gate as the
-- other /d/<token> functions: the delivery's access key, before it expires.
-- It counts nothing (listing isn't downloading); the file routes still go
-- through ots_delivery_file(), which does.

create or replace function public.ots_delivery_episodes(p_token text, p_key text)
returns table (
  episode_id text,
  bucket     text,
  prefix     text,
  domain     text,
  skill      text,
  difficulty text,
  duration_s integer,
  task_name  text,
  kind       text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select e.episode_id, e.bucket, e.prefix, e.domain, e.skill, e.difficulty, e.duration_s, e.task_name,
         q.kind, o.expires_at
    from public.ots_deliveries o
    join public.ots_requests q on q.id = o.request_id
    join public.ots_delivery_items i on i.delivery_id = o.id
    join public.ots_episodes e on e.episode_id = i.episode_id
   where q.token = p_token and o.access_key = p_key and o.expires_at >= now()
   order by e.domain, e.skill, i.position;
$$;

revoke all on function public.ots_delivery_episodes(text, text) from public;
grant execute on function public.ots_delivery_episodes(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
