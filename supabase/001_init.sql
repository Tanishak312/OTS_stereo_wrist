-- OTS kiosk: dataset + sample requests and their review trail.
-- Run once in the Supabase SQL editor (as the project owner). Safe to re-run:
-- every object is created with IF NOT EXISTS / OR REPLACE.
--
-- Access model
--   * Kiosk visitors (anon key) can do exactly one thing: call
--     submit_ots_request(). They cannot read, update or delete any row.
--   * Admins are Supabase Auth users listed in ots_admins. They can read
--     requests and events, and change status only through
--     set_ots_request_status() (002_review_rules.sql), which writes an audit
--     event every time.
--   * No table has an insert/update/delete policy, so direct table writes
--     through the API are refused for everyone.

create extension if not exists pgcrypto;

create sequence if not exists public.ots_request_seq start 1001;

create table if not exists public.ots_requests (
  id              uuid primary key default gen_random_uuid(),
  token           text not null unique
                  default ('OTS-' || lpad(nextval('public.ots_request_seq')::text, 4, '0')),
  kind            text not null check (kind in ('dataset', 'sample')),
  status          text not null default 'submitted'
                  check (status in ('submitted', 'in_review', 'approved', 'rejected', 'sample_sent')),
  capture_setup   text not null check (capture_setup in ('ego', 'head_wrist')),
  environments    text[] not null
                  check (cardinality(environments) between 1 and 21
                         and array_to_string(environments, ',') ~ '^[a-z-]+(,[a-z-]+)*$'),
  skills          text[] not null default '{}'
                  check (cardinality(skills) <= 18
                         and (cardinality(skills) = 0 or array_to_string(skills, ',') ~ '^[a-z-]+(,[a-z-]+)*$')),
  difficulties    text[] not null default '{}'
                  check (difficulties <@ array['easy', 'medium', 'hard']),
  matching_hours  integer not null check (matching_hours >= 0),
  requested_hours integer check (requested_hours is null or requested_hours > 0), -- sample size: 50 h, or less if fewer hours match
  delivery_format text not null default 'MCAP + calibration',
  full_name       text not null check (char_length(full_name) between 1 and 120),
  email           text not null check (char_length(email) between 3 and 254 and position('@' in email) > 1),
  phone           text check (phone is null or char_length(phone) <= 20),
  company         text check (company is null or char_length(company) <= 160),
  source          text not null default 'kiosk',
  is_demo         boolean not null default false,
  review_note     text,
  reviewed_by     uuid references auth.users (id) on delete set null,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists ots_requests_created_at_idx on public.ots_requests (created_at desc);
create index if not exists ots_requests_status_idx on public.ots_requests (status);

create table if not exists public.ots_request_events (
  id          bigint generated always as identity primary key,
  request_id  uuid not null references public.ots_requests (id) on delete cascade,
  from_status text,
  to_status   text not null,
  note        text,
  actor       uuid references auth.users (id) on delete set null,
  actor_email text,
  created_at  timestamptz not null default now()
);

create index if not exists ots_request_events_request_idx on public.ots_request_events (request_id, created_at);

create table if not exists public.ots_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now()
);

alter table public.ots_requests       enable row level security;
alter table public.ots_request_events enable row level security;
alter table public.ots_admins         enable row level security;

-- Supabase grants table privileges to anon/authenticated by default; take the
-- write ones back so RLS is not the only thing standing in the way.
revoke insert, update, delete, truncate on public.ots_requests, public.ots_request_events, public.ots_admins
  from anon, authenticated;
revoke select on public.ots_requests, public.ots_request_events, public.ots_admins from anon;

create or replace function public.is_ots_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.ots_admins where user_id = auth.uid());
$$;

drop policy if exists "admins read requests" on public.ots_requests;
create policy "admins read requests" on public.ots_requests
  for select to authenticated using (public.is_ots_admin());

drop policy if exists "admins read events" on public.ots_request_events;
create policy "admins read events" on public.ots_request_events
  for select to authenticated using (public.is_ots_admin());

drop policy if exists "admins read admins" on public.ots_admins;
create policy "admins read admins" on public.ots_admins
  for select to authenticated using (public.is_ots_admin());

-- Kiosk submit. The only write path open to the anon key.
create or replace function public.submit_ots_request(
  p_kind           text,
  p_setup          text,
  p_environments   text[],
  p_skills         text[],
  p_difficulties   text[],
  p_matching_hours integer,
  p_full_name      text,
  p_email          text,
  p_phone          text default null,
  p_company        text default null,
  p_source         text default 'kiosk'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_token text;
begin
  insert into public.ots_requests (
    kind, capture_setup, environments, skills, difficulties,
    matching_hours, requested_hours, full_name, email, phone, company, source
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
    left(coalesce(nullif(trim(p_source), ''), 'kiosk'), 40)
  )
  returning id, token into v_id, v_token;

  insert into public.ots_request_events (request_id, from_status, to_status)
  values (v_id, null, 'submitted');

  return v_token;
end;
$$;

revoke all on function public.is_ots_admin() from public, anon;
revoke all on function public.submit_ots_request(text, text, text[], text[], text[], integer, text, text, text, text, text) from public;

grant execute on function public.is_ots_admin() to authenticated;
grant execute on function public.submit_ots_request(text, text, text[], text[], text[], integer, text, text, text, text, text) to anon, authenticated;
