-- Optional demo rows so the admin dashboard is not empty on first run.
-- Run after 001_init.sql and 002_review_rules.sql.
-- Every row is marked is_demo = true and uses example.com addresses.
-- Remove them later with:  delete from public.ots_requests where is_demo;
-- (events go with them via ON DELETE CASCADE).

with inserted as (
  insert into public.ots_requests (
    kind, status, capture_setup, environments, skills, difficulties,
    matching_hours, requested_hours, full_name, email, phone, company, is_demo, review_note, reviewed_at, created_at
  ) values
    ('dataset', 'approved', 'ego', array['industrial-manufacturing', 'repair-services'], array['tool-use', 'assembly'], '{}',
       336, null, 'Maya Rao', 'maya@example.com', null, 'Example Robotics', true, 'Delivery plan shared.', now() - interval '2 days', now() - interval '3 days'),
    ('sample', 'sample_sent', 'ego', array['food-beverage'], array['food-prep'], array['medium'],
       23, 50, 'Leo Mathew', 'leo@example.com', null, 'Example Labs', true, null, now() - interval '1 day', now() - interval '2 days'),
    ('dataset', 'rejected', 'head_wrist', array['retail-consumer-goods'], '{}', '{}',
       16, null, 'Alex Fernandes', 'alex@example.com', null, null, true, 'Duplicate of an earlier request.', now() - interval '1 day', now() - interval '2 days'),
    ('dataset', 'in_review', 'ego', array['home', 'cleaning-sanitation', 'hospitality'], array['cleaning', 'organization'], array['easy', 'medium'],
       33, null, 'Nina Kapoor', 'nina@example.com', '+91 98765 00001', 'Example AI', true, null, null, now() - interval '5 hours'),
    ('sample', 'submitted', 'ego', array['clothing-fashion'], array['clothing-laundry'], '{}',
       28, 50, 'Sam Iyer', 'sam@example.com', null, null, true, null, null, now() - interval '2 hours'),
    ('dataset', 'submitted', 'head_wrist', array['industrial-manufacturing', 'construction-hardware'], '{}', array['hard'],
       18, null, 'Priya Sharma', 'priya@example.com', '+91 98765 43210', 'Robotics AI Labs', true, null, null, now() - interval '20 minutes')
  returning id, status, review_note, created_at, reviewed_at
)
insert into public.ots_request_events (request_id, from_status, to_status, note, actor_email, created_at)
select id, null, 'submitted', null, null, created_at from inserted
union all
select id, 'submitted', status, review_note, 'demo@example.com', coalesce(reviewed_at, created_at + interval '1 hour')
  from inserted where status <> 'submitted';
