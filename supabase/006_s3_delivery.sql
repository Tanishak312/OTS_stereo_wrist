-- Large datasets can be delivered straight into the customer's own S3 bucket.
-- Run after 005_inventory.sql. Safe to re-run.
--
-- The kiosk's dataset form asks "Download link" or "Send to my S3 bucket"; for
-- S3 it takes the bucket, region, folder and an access key the customer made
-- for us.
--
--   * Bucket, region, folder and access key ID sit on ots_requests, so admins
--     see them on the request page. None of them is secret.
--   * The secret access key never reaches the database in the clear: the app
--     server encrypts it (AES-256-GCM, key S3_CREDS_KEY in the server's .env,
--     never in Supabase) before calling submit_ots_request(). The ciphertext
--     lives in its own table with RLS on and no policies, so not even the admin
--     dashboard's select("*") can read it. Only ots_s3_secret() hands it out,
--     to admins, still encrypted; the transfer machine holds the key to open it.
--   * ots_forget_s3_secret() deletes it once the transfer is done.

alter table public.ots_requests add column if not exists delivery_method text not null default 'download';
alter table public.ots_requests add column if not exists s3_bucket text;
alter table public.ots_requests add column if not exists s3_region text;
alter table public.ots_requests add column if not exists s3_prefix text;
alter table public.ots_requests add column if not exists s3_access_key_id text;

alter table public.ots_requests drop constraint if exists ots_requests_delivery_check;
alter table public.ots_requests add constraint ots_requests_delivery_check check (
  (delivery_method = 'download'
     and s3_bucket is null and s3_region is null and s3_prefix is null and s3_access_key_id is null)
  or (delivery_method = 's3' and kind = 'dataset'
     and s3_bucket ~ '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$'
     and s3_region ~ '^[a-z0-9-]{2,32}$'
     and (s3_prefix is null or char_length(s3_prefix) <= 200)
     and s3_access_key_id ~ '^[A-Z0-9]{16,128}$')
);

create table if not exists public.ots_request_s3_secrets (
  request_id  uuid primary key references public.ots_requests (id) on delete cascade,
  secret_enc  text not null check (secret_enc like 'v1:%' and char_length(secret_enc) <= 1000),
  created_at  timestamptz not null default now()
);

alter table public.ots_request_s3_secrets enable row level security;
revoke all on public.ots_request_s3_secrets from anon, authenticated;

-- The submit RPC gains the delivery fields. The old signature is dropped so
-- PostgREST has exactly one candidate; calls that leave the new arguments out
-- (the kiosk build running today) still land here through the defaults.
drop function if exists public.submit_ots_request(text, text, text[], text[], text[], integer, text, text, text, text, text);

create or replace function public.submit_ots_request(
  p_kind              text,
  p_setup             text,
  p_environments      text[],
  p_skills            text[],
  p_difficulties      text[],
  p_matching_hours    integer,
  p_full_name         text,
  p_email             text,
  p_phone             text default null,
  p_company           text default null,
  p_source            text default 'kiosk',
  p_delivery_method   text default 'download',
  p_s3_bucket         text default null,
  p_s3_region         text default null,
  p_s3_prefix         text default null,
  p_s3_access_key_id  text default null,
  p_s3_secret_enc     text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_token  text;
  v_method text := coalesce(nullif(trim(p_delivery_method), ''), 'download');
begin
  if v_method = 's3' and nullif(trim(p_s3_secret_enc), '') is null then
    raise exception 'S3 delivery needs the secret access key' using errcode = '22023';
  end if;

  insert into public.ots_requests (
    kind, capture_setup, environments, skills, difficulties,
    matching_hours, requested_hours, full_name, email, phone, company, source,
    delivery_method, s3_bucket, s3_region, s3_prefix, s3_access_key_id
  ) values (
    p_kind,
    p_setup,
    coalesce(p_environments, '{}'),
    coalesce(p_skills, '{}'),
    coalesce(p_difficulties, '{}'),
    greatest(coalesce(p_matching_hours, 0), 0),
    case when p_kind = 'sample' then least(50, greatest(coalesce(p_matching_hours, 0), 1)) end,
    trim(p_full_name),
    lower(trim(p_email)),
    nullif(trim(p_phone), ''),
    nullif(trim(p_company), ''),
    left(coalesce(nullif(trim(p_source), ''), 'kiosk'), 40),
    v_method,
    case when v_method = 's3' then lower(trim(p_s3_bucket)) end,
    case when v_method = 's3' then lower(trim(p_s3_region)) end,
    case when v_method = 's3' then nullif(trim(p_s3_prefix), '') end,
    case when v_method = 's3' then upper(trim(p_s3_access_key_id)) end
  )
  returning id, token into v_id, v_token;

  if v_method = 's3' then
    insert into public.ots_request_s3_secrets (request_id, secret_enc) values (v_id, trim(p_s3_secret_enc));
  end if;

  insert into public.ots_request_events (request_id, from_status, to_status)
  values (v_id, null, 'submitted');

  return v_token;
end;
$$;

-- Admins only: whether a key is on file, and its ciphertext for the transfer machine.
create or replace function public.ots_s3_secret(p_token text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_ots_admin() then
    raise exception 'not an OTS admin' using errcode = '42501';
  end if;
  return (select s.secret_enc
            from public.ots_request_s3_secrets s
            join public.ots_requests r on r.id = s.request_id
           where r.token = p_token);
end;
$$;

-- Admins only: drop the stored key after the transfer (or when the customer revokes it).
create or replace function public.ots_forget_s3_secret(p_token text)
returns boolean
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
  delete from public.ots_request_s3_secrets s
   using public.ots_requests r
   where r.id = s.request_id and r.token = p_token;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

revoke all on function public.submit_ots_request(text, text, text[], text[], text[], integer, text, text, text, text, text, text, text, text, text, text, text) from public;
revoke all on function public.ots_s3_secret(text) from public, anon;
revoke all on function public.ots_forget_s3_secret(text) from public, anon;

grant execute on function public.submit_ots_request(text, text, text[], text[], text[], integer, text, text, text, text, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.ots_s3_secret(text) to authenticated;
grant execute on function public.ots_forget_s3_secret(text) to authenticated;

notify pgrst, 'reload schema';
