-- Head + wrist free samples. Run after 014_manual_delivery.sql, BEFORE the code
-- that uses it. Safe to re-run. No request is changed.
--
--   Ego-centric sample   unchanged: the Google Drive link is emailed and the
--                        request becomes Sent.
--   Head + wrist sample  has no Drive folder. The first email only says the
--                        sample is being prepared, so the request stays Pending
--                        delivery. An admin later emails the keys of a shared
--                        R2 bucket from the request page, which makes it Sent.
--
-- As in 014, the bucket's secret key is never stored.

-- The automatic email. Only a sample that really got its link becomes Sent.
create or replace function public.ots_record_customer_email(p_token text, p_email_id text, p_error text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r       public.ots_requests;
  v_err   text := left(nullif(trim(p_error), ''), 500);
  v_sent  boolean;
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

  v_sent := r.kind = 'sample' and r.capture_setup <> 'head_wrist' and r.status = 'submitted';

  update public.ots_requests
     set customer_emailed_at  = now(),
         customer_email_id    = left(p_email_id, 200),
         customer_email_error = null,
         status               = case when v_sent then 'sample_sent' else r.status end,
         updated_at           = now()
   where id = r.id;

  if v_sent then
    insert into public.ots_request_events (request_id, from_status, to_status, note, actor, actor_email)
    values (r.id, r.status, 'sample_sent', 'Google Drive link emailed', auth.uid(),
            (select email from auth.users where id = auth.uid()));
  end if;
end;
$$;

-- After an admin's email has gone out. A dataset becomes Access sent, a head +
-- wrist sample becomes Sent. Sending again is allowed (say, a new key).
create or replace function public.ots_record_access_sent(p_token text, p_bucket text, p_access_key_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r      public.ots_requests;
  v_to   text;
  v_mail text;
begin
  if not public.is_ots_admin() then
    raise exception 'Only OTS admins can record bucket access.' using errcode = '42501';
  end if;

  select * into r from public.ots_requests where token = p_token for update;
  if not found or not (r.kind = 'dataset' or (r.kind = 'sample' and r.capture_setup = 'head_wrist')) then
    raise exception 'No dataset or head + wrist sample request %.', p_token using errcode = 'P0002';
  end if;
  if r.status not in ('submitted', 'in_review', 'approved', 'sample_sent') then
    raise exception 'Request % is % and cannot be given access.', p_token, r.status using errcode = '22023';
  end if;

  v_to := case when r.kind = 'sample' then 'sample_sent' else 'approved' end;
  select email into v_mail from auth.users where id = auth.uid();

  update public.ots_requests
     set status         = v_to,
         access_bucket  = p_bucket,
         access_key_id  = p_access_key_id,
         access_sent_at = now(),
         reviewed_by    = auth.uid(),
         reviewed_at    = now(),
         updated_at     = now()
   where id = r.id;

  insert into public.ots_request_events (request_id, from_status, to_status, note, actor, actor_email)
  values (r.id, r.status, v_to, format('Bucket access emailed: %s', p_bucket), auth.uid(), v_mail);
end;
$$;

notify pgrst, 'reload schema';
