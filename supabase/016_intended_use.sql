-- Intended use, asked on the details form:
--   "Do you want this data for your model/robot training?"  Yes / No, required.
-- Run after 015_head_wrist_sample_bucket.sql, BEFORE the code that sends it.
-- Safe to re-run, including over an earlier copy of this file. No existing request
-- is changed: they keep null, which the admin shows as "Not asked".
--
--   for_training  true = Yes, false = No, null = request made before the question
--   for_own_lab   the question this replaced ("for your lab?"). Kept, never dropped,
--                 so any answer already stored stays readable; the form no longer asks it.

alter table public.ots_requests
  add column if not exists for_own_lab  boolean,
  add column if not exists for_training boolean;

-- The kiosk submit gains the answers. Earlier signatures are dropped first so two
-- can't sit side by side and make the call ambiguous. The new arguments default to
-- null, so the code already deployed keeps working between this and the deploy.
drop function if exists public.submit_ots_request(text, text, text[], text[], text[], integer, text, text, text, text, text, bigint, jsonb);
drop function if exists public.submit_ots_request(text, text, text[], text[], text[], integer, text, text, text, text, text, bigint, jsonb, boolean);

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
  p_source         text default 'kiosk',
  p_matching_bytes bigint default null,
  p_breakdown      jsonb default null,
  p_for_own_lab    boolean default null,
  p_for_training   boolean default null
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
    matching_hours, requested_hours, matching_bytes, breakdown, full_name, email, phone, company, source,
    for_own_lab, for_training
  ) values (
    p_kind,
    p_setup,
    coalesce(p_environments, '{}'),
    coalesce(p_skills, '{}'),
    coalesce(p_difficulties, '{}'),
    greatest(coalesce(p_matching_hours, 0), 0),
    case when p_kind = 'sample' then least(50, greatest(coalesce(p_matching_hours, 0), 1)) end,
    p_matching_bytes,
    p_breakdown,
    trim(p_full_name),
    lower(trim(p_email)),
    nullif(trim(p_phone), ''),
    nullif(trim(p_company), ''),
    left(coalesce(nullif(trim(p_source), ''), 'kiosk'), 40),
    p_for_own_lab,
    p_for_training
  )
  returning id, token into v_id, v_token;

  insert into public.ots_request_events (request_id, from_status, to_status)
  values (v_id, null, 'submitted');

  return v_token;
end;
$$;

revoke all on function public.submit_ots_request(text, text, text[], text[], text[], integer, text, text, text, text, text, bigint, jsonb, boolean, boolean) from public;
grant execute on function public.submit_ots_request(text, text, text[], text[], text[], integer, text, text, text, text, text, bigint, jsonb, boolean, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
