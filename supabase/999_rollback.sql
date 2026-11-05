-- Undo every migration completely. DESTROYS every OTS request, event, delivery and
-- the episode index. Only run this if you really want the tables gone.
-- (R2 is untouched either way; nothing here ever wrote to it.)

-- 014_manual_delivery.sql (its columns go with ots_requests below; the app's old
-- delivery functions stay switched off until they're dropped below)
drop function if exists public.ots_record_access_sent(text, text, text);
drop function if exists public.ots_record_customer_email(text, text, text);
drop function if exists public.submit_ots_request(text, text, text[], text[], text[], integer, text, text, text, text, text, bigint, jsonb);

-- 013_sample_mcap.sql
drop function if exists public.ots_prepare_sample(text, boolean);

-- 011_mcap_delivery.sql (columns go with their tables below)
drop function if exists public.ots_prepare_dataset(text, boolean);
drop function if exists public.ots_inventory_rebuild();
drop table if exists public.ots_episode_mcap_sizes;

-- 010_inventory_summary.sql
drop trigger if exists ots_inventory_row on public.ots_episodes;
drop trigger if exists ots_inventory_truncate on public.ots_episodes;
drop function if exists public.ots_inventory_on_truncate();
drop function if exists public.ots_inventory_on_row();
drop function if exists public.ots_inventory_apply(public.ots_episodes, integer);
drop function if exists public.ots_task_key(text);
drop table if exists public.ots_inventory_tasks;
drop table if exists public.ots_inventory_cells;

-- 009_head_wrist.sql (functions it recreated are dropped below with their files)
drop trigger if exists ots_requests_delivery_format on public.ots_requests;
drop function if exists public.ots_requests_delivery_format();

-- 008_s3_transfer_jobs.sql
drop function if exists public.ots_finish_transfer(uuid, boolean, text, boolean);
drop function if exists public.ots_transfer_progress(uuid, integer, integer, bigint, bigint, text);
drop function if exists public.ots_transfer_episodes(uuid);
drop function if exists public.ots_claim_transfer();
drop function if exists public.ots_cancel_transfer(text);
drop function if exists public.ots_start_transfer(text, boolean);
drop function if exists public.is_ots_worker();
drop table if exists public.ots_transfers;
drop table if exists public.ots_workers;

-- 007_mapped_delivery.sql
drop function if exists public.ots_delivery_episodes(text, text);

-- 006_s3_delivery.sql
drop function if exists public.ots_forget_s3_secret(text);
drop function if exists public.ots_s3_secret(text);
drop function if exists public.submit_ots_request(text, text, text[], text[], text[], integer, text, text, text, text, text, text, text, text, text, text, text);
drop table if exists public.ots_request_s3_secrets;

-- 005_inventory.sql
drop function if exists public.ots_inventory();

-- 004_dataset_delivery.sql
drop function if exists public.ots_prepare_dataset(text);
drop function if exists public.ots_record_delivery_email(text, text, text, text);

-- 003_episodes_delivery.sql
drop function if exists public.ots_delivery_file(text, text, text, text);
drop function if exists public.ots_delivery_file(text, text, text);
drop function if exists public.ots_get_delivery(text, text);
drop function if exists public.ots_record_sample_email(text, text, text, text);
drop function if exists public.ots_prepare_sample(text);
drop table if exists public.ots_delivery_items;
drop table if exists public.ots_deliveries;
drop table if exists public.ots_episodes;

-- 001 / 002
drop function if exists public.set_ots_request_status(text, text, text);
drop function if exists public.submit_ots_request(text, text, text[], text[], text[], integer, text, text, text, text, text);
drop table if exists public.ots_request_events;
drop table if exists public.ots_requests;
drop table if exists public.ots_admins;
drop function if exists public.is_ots_admin();
drop sequence if exists public.ots_request_seq;
