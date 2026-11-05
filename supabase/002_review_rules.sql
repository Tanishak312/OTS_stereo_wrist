-- Admin status changes. Run after 001_init.sql. Safe to re-run.
--
-- Two kinds of request, two different paths:
--   dataset  (full dataset)   needs an admin decision
--       submitted / in_review -> in_review | approved | rejected
--       rejected              -> in_review   (reopen)
--   sample   (free 50 h)      no approval; it goes out on its own
--       submitted (pending delivery) -> sample_sent
--       Until automatic delivery exists, an admin sends it by hand and
--       marks it sent here. That manual step is a stopgap.
-- Every change is logged in ots_request_events.

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
  elsif v_from = p_status or not (
       (v_from in ('submitted', 'in_review') and p_status in ('in_review', 'approved', 'rejected'))
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

revoke all on function public.set_ots_request_status(text, text, text) from public, anon;
grant execute on function public.set_ots_request_status(text, text, text) to authenticated;

-- Demo rows from 900_demo_seed.sql created before this rule had a sample in
-- 'approved'; move those to the new end state. Touches demo rows only.
update public.ots_requests
   set status = 'sample_sent', updated_at = now()
 where is_demo and kind = 'sample' and status = 'approved';
