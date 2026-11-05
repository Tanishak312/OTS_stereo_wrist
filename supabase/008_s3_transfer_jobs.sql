-- "Start S3 copy": an admin starts the copy of an approved S3 delivery from the
-- request page; a worker (scripts/s3-worker.mjs, on its own machine) picks it
-- up, copies the dataset into the customer's bucket, reports progress here,
-- emails the customer when it's complete and deletes their stored key.
-- Run after 007_mapped_delivery.sql. Safe to re-run.
--
-- Who can do what
--   * Admins: start / cancel a transfer (ots_start_transfer, ots_cancel_transfer)
--     and read ots_transfers. Nothing runs until an admin presses Start.
--   * The worker signs in as its own Supabase Auth user, listed in ots_workers
--     (NOT in ots_admins). It can only claim queued transfers, read what it needs
--     for them, report progress and finish them. No service-role key anywhere.
--
-- Setup (once, by the project owner):
--   1. Authentication -> Users -> Add user, e.g. ots-worker@awign.com, strong password.
--   2. insert into public.ots_workers (user_id, email)
--      select id, email from auth.users where email = 'ots-worker@awign.com';

create table if not exists public.ots_workers (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.ots_transfers (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null unique references public.ots_requests (id) on delete cascade,
  status        text not null default 'queued'
                check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  with_mcap     boolean not null default false,  -- decided by the app (OFFER_MCAP) when the admin starts it
  attempts      integer not null default 0,
  files_total   integer,
  files_done    integer not null default 0,
  bytes_total   bigint,
  bytes_done    bigint not null default 0,
  message       text,                            -- latest progress line or failure reason
  requested_by  text,
  requested_at  timestamptz not null default now(),
  started_at    timestamptz,
  heartbeat_at  timestamptz,
  finished_at   timestamptz,
  emailed_at    timestamptz,
  worker_email  text
);

alter table public.ots_workers   enable row level security;
alter table public.ots_transfers enable row level security;
revoke all on public.ots_workers, public.ots_transfers from anon;
revoke insert, update, delete, truncate on public.ots_workers, public.ots_transfers from authenticated;

drop policy if exists "admins read transfers" on public.ots_transfers;
create policy "admins read transfers" on public.ots_transfers
  for select to authenticated using (public.is_ots_admin());

create or replace function public.is_ots_worker()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.ots_workers where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------- admin

create or replace function public.ots_start_transfer(p_token text, p_with_mcap boolean default false)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r   public.ots_requests;
  v_n integer;
  t   public.ots_transfers;
begin
  if not public.is_ots_admin() then
    raise exception 'not an OTS admin' using errcode = '42501';
  end if;
  select * into r from public.ots_requests where token = p_token;
  if r.id is null then raise exception 'No request %', p_token; end if;
  if r.kind <> 'dataset' or r.delivery_method <> 's3' then raise exception '% is not an S3 delivery', p_token; end if;
  if r.status <> 'approved' then raise exception 'Approve % before starting the copy', p_token; end if;
  select episode_count into v_n from public.ots_deliveries where request_id = r.id;
  if coalesce(v_n, 0) = 0 then raise exception '% has no prepared episodes', p_token; end if;
  if not exists (select 1 from public.ots_request_s3_secrets where request_id = r.id) then
    raise exception 'The customer''s S3 key for % has been deleted; ask them for a new one', p_token;
  end if;

  select * into t from public.ots_transfers where request_id = r.id;
  if t.status in ('queued', 'running') then
    raise exception 'The copy for % is already %', p_token, t.status;
  end if;
  if t.status = 'done' then
    raise exception 'The copy for % is already complete', p_token;
  end if;

  insert into public.ots_transfers (request_id, status, with_mcap, requested_by)
  values (r.id, 'queued', coalesce(p_with_mcap, false), (select email from public.ots_admins where user_id = auth.uid()))
  on conflict (request_id) do update
    set status = 'queued', with_mcap = excluded.with_mcap, requested_by = excluded.requested_by,
        requested_at = now(), started_at = null, heartbeat_at = null, finished_at = null,
        files_done = 0, bytes_done = 0, message = null;
  return 'queued';
end;
$$;

create or replace function public.ots_cancel_transfer(p_token text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if not public.is_ots_admin() then
    raise exception 'not an OTS admin' using errcode = '42501';
  end if;
  update public.ots_transfers t
     set status = 'cancelled', finished_at = now(),
         message = 'Cancelled by ' || coalesce((select email from public.ots_admins where user_id = auth.uid()), 'an admin')
    from public.ots_requests r
   where r.id = t.request_id and r.token = p_token and t.status in ('queued', 'running');
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'No queued or running copy for %', p_token; end if;
  return 'cancelled';
end;
$$;

-- ---------------------------------------------------------------- worker

-- Takes the oldest queued transfer, or one whose worker went silent for 15
-- minutes (crashed or restarted; the copy resumes, skipping files already there).
create or replace function public.ots_claim_transfer()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.ots_transfers;
  r public.ots_requests;
begin
  if not public.is_ots_worker() then
    raise exception 'not an OTS worker' using errcode = '42501';
  end if;
  select * into t from public.ots_transfers
   where status = 'queued' or (status = 'running' and heartbeat_at < now() - interval '15 minutes')
   order by requested_at
   limit 1
   for update skip locked;
  if t.id is null then return null; end if;

  update public.ots_transfers
     set status = 'running', attempts = attempts + 1, started_at = coalesce(started_at, now()), heartbeat_at = now(),
         worker_email = (select email from public.ots_workers where user_id = auth.uid()),
         message = case when t.status = 'running' then 'Resumed after the previous worker went silent' else 'Starting' end
   where id = t.id;

  select * into r from public.ots_requests where id = t.request_id;
  return jsonb_build_object(
    'transfer_id', t.id,
    'token', r.token,
    'email', r.email,
    'full_name', r.full_name,
    'with_mcap', t.with_mcap,
    'destination', jsonb_build_object(
      'bucket', r.s3_bucket, 'region', r.s3_region, 'prefix', r.s3_prefix, 'access_key_id', r.s3_access_key_id,
      'secret_enc', (select secret_enc from public.ots_request_s3_secrets where request_id = r.id)),
    'access_key', (select access_key from public.ots_deliveries where request_id = r.id),
    'expires_at', (select expires_at from public.ots_deliveries where request_id = r.id));
end;
$$;

-- The episodes of a running transfer, in delivery order (call with .range() to page).
create or replace function public.ots_transfer_episodes(p_transfer_id uuid)
returns table (
  episode_id text, bucket text, prefix text, domain text, skill text,
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
    select e.episode_id, e.bucket, e.prefix, e.domain, e.skill, e.difficulty, e.duration_s, e.task_name
      from public.ots_transfers t
      join public.ots_deliveries o on o.request_id = t.request_id
      join public.ots_delivery_items i on i.delivery_id = o.id
      join public.ots_episodes e on e.episode_id = i.episode_id
     where t.id = p_transfer_id and t.status = 'running'
     order by i.position;
end;
$$;

-- Progress + heartbeat. Returns the transfer's status, so the worker notices a cancel.
create or replace function public.ots_transfer_progress(
  p_transfer_id uuid,
  p_files_total integer,
  p_files_done  integer,
  p_bytes_total bigint,
  p_bytes_done  bigint,
  p_message     text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not public.is_ots_worker() then
    raise exception 'not an OTS worker' using errcode = '42501';
  end if;
  update public.ots_transfers
     set files_total = p_files_total, files_done = p_files_done, bytes_total = p_bytes_total, bytes_done = p_bytes_done,
         message = left(p_message, 500), heartbeat_at = now()
   where id = p_transfer_id and status = 'running'
  returning status into v_status;
  return coalesce(v_status, (select status from public.ots_transfers where id = p_transfer_id));
end;
$$;

-- Ends a transfer. On success the customer's stored key is deleted in the same
-- transaction. A transfer an admin cancelled meanwhile stays cancelled.
create or replace function public.ots_finish_transfer(p_transfer_id uuid, p_ok boolean, p_message text, p_emailed boolean default false)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.ots_transfers;
begin
  if not public.is_ots_worker() then
    raise exception 'not an OTS worker' using errcode = '42501';
  end if;
  select * into t from public.ots_transfers where id = p_transfer_id for update;
  if t.id is null then raise exception 'No transfer %', p_transfer_id; end if;
  if t.status <> 'running' then return t.status; end if;

  update public.ots_transfers
     set status = case when p_ok then 'done' else 'failed' end,
         message = left(p_message, 500), finished_at = now(), heartbeat_at = now(),
         emailed_at = case when p_emailed then now() else emailed_at end
   where id = t.id;
  if p_ok then
    delete from public.ots_request_s3_secrets where request_id = t.request_id;
  end if;
  return case when p_ok then 'done' else 'failed' end;
end;
$$;

revoke all on function public.is_ots_worker() from public, anon;
revoke all on function public.ots_start_transfer(text, boolean) from public, anon;
revoke all on function public.ots_cancel_transfer(text) from public, anon;
revoke all on function public.ots_claim_transfer() from public, anon;
revoke all on function public.ots_transfer_episodes(uuid) from public, anon;
revoke all on function public.ots_transfer_progress(uuid, integer, integer, bigint, bigint, text) from public, anon;
revoke all on function public.ots_finish_transfer(uuid, boolean, text, boolean) from public, anon;

grant execute on function public.is_ots_worker() to authenticated;
grant execute on function public.ots_start_transfer(text, boolean) to authenticated;
grant execute on function public.ots_cancel_transfer(text) to authenticated;
grant execute on function public.ots_claim_transfer() to authenticated;
grant execute on function public.ots_transfer_episodes(uuid) to authenticated;
grant execute on function public.ots_transfer_progress(uuid, integer, integer, bigint, bigint, text) to authenticated;
grant execute on function public.ots_finish_transfer(uuid, boolean, text, boolean) to authenticated;

notify pgrst, 'reload schema';
