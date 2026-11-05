-- New delivery flow. Run after 013_sample_mcap.sql, together with the code that
-- uses it. Safe to re-run. No request, episode or delivery row is changed or deleted.
--
--   Free sample   no approval: the visitor is emailed the setup's Google Drive
--                 folder (the same link for everyone).
--   Full dataset  the customer is emailed a confirmation straight away. An admin
--                 fills an R2 bucket by hand, then emails its access keys from
--                 the request page, which is what marks the request as done.
--
-- The app no longer prepares deliveries, signs R2 links or copies into a
-- customer's bucket. Those tables and columns stay as they are; only the
-- functions behind them are switched off (section 5).
--
-- The bucket's secret key is never stored anywhere in the database: only the
-- bucket name and the access key ID, so a sent key can be found and revoked.

-- ---------------------------------------------------------------- 1. columns

alter table public.ots_requests
  add column if not exists matching_bytes       bigint check (matching_bytes is null or matching_bytes >= 0),
  -- Per environment, then per skill, as it stood when the customer asked.
  add column if not exists breakdown            jsonb check (breakdown is null or (jsonb_typeof(breakdown) = 'array' and pg_column_size(breakdown) <= 65536)),
  -- The automatic email: the Drive link (sample) or the confirmation (dataset).
  add column if not exists customer_emailed_at  timestamptz,
  add column if not exists customer_email_id    text,
  add column if not exists customer_email_error text,
  -- The bucket access sent by an admin. Never the secret key.
  add column if not exists access_bucket        text,
  add column if not exists access_key_id        text,
  add column if not exists access_sent_at       timestamptz;

-- ---------------------------------------------------------------- 2. kiosk submit

-- The S3 arguments are gone and the snapshot of what was asked for is in.
drop function if exists public.submit_ots_request(text, text, text[], text[], text[], integer, text, text, text, text, text, text, text, text, text, text, text);

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
  p_breakdown      jsonb default null
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
    matching_hours, requested_hours, matching_bytes, breakdown, full_name, email, phone, company, source
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
    left(coalesce(nullif(trim(p_source), ''), 'kiosk'), 40)
  )
  returning id, token into v_id, v_token;

  insert into public.ots_request_events (request_id, from_status, to_status)
  values (v_id, null, 'submitted');

  return v_token;
end;
$$;

-- ---------------------------------------------------------------- 3. the automatic email

-- Called by the kiosk after submit, and by an admin who sends it again. A sample
-- becomes Sent; a failure is kept for the admin to see. The kiosk (anon) can only
-- report a request's first email, so it can't overwrite one that went out.
create or replace function public.ots_record_customer_email(p_token text, p_email_id text, p_error text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r     public.ots_requests;
  v_err text := left(nullif(trim(p_error), ''), 500);
begin
  select * into r from public.ots_requests where token = p_token for update;
  if not found then
    raise exception 'Request % was not found.', p_token using errcode = 'P0002';
  end if;
  if r.customer_emailed_at is not null and not public.is_ots_admin() then
    return;
  end if;

  if v_err is not null then
    update public.ots_requests set customer_email_error = v_err, updated_at = now() where id = r.id;
    return;
  end if;

  update public.ots_requests
     set customer_emailed_at  = now(),
         customer_email_id    = left(p_email_id, 200),
         customer_email_error = null,
         status               = case when r.kind = 'sample' and r.status = 'submitted' then 'sample_sent' else r.status end,
         updated_at           = now()
   where id = r.id;

  if r.kind = 'sample' and r.status = 'submitted' then
    insert into public.ots_request_events (request_id, from_status, to_status, note, actor, actor_email)
    values (r.id, r.status, 'sample_sent', 'Google Drive link emailed', auth.uid(),
            (select email from auth.users where id = auth.uid()));
  end if;
end;
$$;

-- ---------------------------------------------------------------- 4. bucket access

-- After an admin's email has gone out. Sending it again is allowed (say, a new
-- key), and each send is one line in the history.
create or replace function public.ots_record_access_sent(p_token text, p_bucket text, p_access_key_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r      public.ots_requests;
  v_mail text;
begin
  if not public.is_ots_admin() then
    raise exception 'Only OTS admins can record bucket access.' using errcode = '42501';
  end if;

  select * into r from public.ots_requests where token = p_token for update;
  if not found or r.kind <> 'dataset' then
    raise exception 'No dataset request %.', p_token using errcode = 'P0002';
  end if;
  if r.status not in ('submitted', 'in_review', 'approved') then
    raise exception 'Request % is % and cannot be given access.', p_token, r.status using errcode = '22023';
  end if;

  select email into v_mail from auth.users where id = auth.uid();

  update public.ots_requests
     set status         = 'approved',
         access_bucket  = p_bucket,
         access_key_id  = p_access_key_id,
         access_sent_at = now(),
         reviewed_by    = auth.uid(),
         reviewed_at    = now(),
         updated_at     = now()
   where id = r.id;

  insert into public.ots_request_events (request_id, from_status, to_status, note, actor, actor_email)
  values (r.id, r.status, 'approved', format('Bucket access emailed: %s', p_bucket), auth.uid(), v_mail);
end;
$$;

-- A dataset now reaches "approved" only by sending its access (section 4), so a
-- request can't look finished when the customer has nothing. Otherwise as in 002.
create or replace function public.set_ots_request_status(
  p_token  text,
  p_status text,
  p_note   text default null
)
returns public.ots_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  r      public.ots_requests;
  v_from text;
  v_note text := nullif(trim(p_note), '');
  v_mail text;
begin
  if not public.is_ots_admin() then
    raise exception 'Only OTS admins can change a request.' using errcode = '42501';
  end if;

  select * into r from public.ots_requests where token = p_token for update;
  if not found then
    raise exception 'Request % was not found.', p_token using errcode = 'P0002';
  end if;

  v_from := r.status;
  if r.kind = 'sample' then
    if not (v_from = 'submitted' and p_status = 'sample_sent') then
      raise exception 'Free samples are not approved or rejected; % can only be marked as sent.', p_token using errcode = '22023';
    end if;
  elsif p_status = 'approved' then
    raise exception 'Send the bucket access for % instead; that marks it as done.', p_token using errcode = '22023';
  elsif v_from = p_status or not (
       (v_from in ('submitted', 'in_review') and p_status in ('in_review', 'rejected'))
    or (v_from = 'rejected' and p_status = 'in_review')
  ) then
    raise exception 'Request % is % and cannot be moved to %.', p_token, v_from, p_status using errcode = '22023';
  end if;

  if p_status = 'rejected' and v_note is null then
    raise exception 'Add a note saying why % is rejected.', p_token using errcode = '22023';
  end if;

  select email into v_mail from auth.users where id = auth.uid();

  update public.ots_requests
     set status      = p_status,
         review_note = coalesce(v_note, review_note),
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         updated_at  = now()
   where id = r.id
  returning * into r;

  insert into public.ots_request_events (request_id, from_status, to_status, note, actor, actor_email)
  values (r.id, v_from, p_status, v_note, auth.uid(), v_mail);

  return r;
end;
$$;

-- ---------------------------------------------------------------- 5. the old delivery, switched off

-- Nothing calls these any more, so nobody should be able to. The functions and
-- their tables stay, so old rows can still be read in the SQL editor.
revoke all on function public.ots_prepare_sample(text, boolean) from public, anon, authenticated;
revoke all on function public.ots_prepare_dataset(text, boolean) from public, anon, authenticated;
revoke all on function public.ots_record_sample_email(text, text, text, text) from public, anon, authenticated;
revoke all on function public.ots_record_delivery_email(text, text, text, text) from public, anon, authenticated;
revoke all on function public.ots_get_delivery(text, text) from public, anon, authenticated;
revoke all on function public.ots_delivery_file(text, text, text, text) from public, anon, authenticated;
revoke all on function public.ots_delivery_episodes(text, text) from public, anon, authenticated;
revoke all on function public.ots_s3_secret(text) from public, anon, authenticated;
revoke all on function public.ots_forget_s3_secret(text) from public, anon, authenticated;
revoke all on function public.ots_start_transfer(text, boolean) from public, anon, authenticated;
revoke all on function public.ots_cancel_transfer(text) from public, anon, authenticated;
revoke all on function public.ots_claim_transfer() from public, anon, authenticated;
revoke all on function public.ots_transfer_episodes(uuid) from public, anon, authenticated;
revoke all on function public.ots_transfer_progress(uuid, integer, integer, bigint, bigint, text) from public, anon, authenticated;
revoke all on function public.ots_finish_transfer(uuid, boolean, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------- grants

revoke all on function public.submit_ots_request(text, text, text[], text[], text[], integer, text, text, text, text, text, bigint, jsonb) from public;
revoke all on function public.ots_record_customer_email(text, text, text) from public;
revoke all on function public.ots_record_access_sent(text, text, text) from public, anon;
revoke all on function public.set_ots_request_status(text, text, text) from public, anon;

grant execute on function public.submit_ots_request(text, text, text[], text[], text[], integer, text, text, text, text, text, bigint, jsonb) to anon, authenticated;
grant execute on function public.ots_record_customer_email(text, text, text) to anon, authenticated;
grant execute on function public.ots_record_access_sent(text, text, text) to authenticated;
grant execute on function public.set_ots_request_status(text, text, text) to authenticated;

notify pgrst, 'reload schema';
