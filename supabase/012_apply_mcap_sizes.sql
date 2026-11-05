-- Copies the imported MCAP sizes onto ots_episodes. Safe to re-run.
-- Run after importing data/ots_episode_mcap_sizes.csv into ots_episode_mcap_sizes.
--
-- All or nothing: if anything fails, no size changes. The row trigger is off during
-- the update, because the summary is recounted once at the end instead of 48k times.

begin;

lock table public.ots_episodes in share row exclusive mode;

alter table public.ots_episodes disable trigger ots_inventory_row;

update public.ots_episodes e
   set mcap_bytes = s.mcap_bytes
  from public.ots_episode_mcap_sizes s
 where s.episode_id = e.episode_id
   and e.mcap_bytes is distinct from s.mcap_bytes;

alter table public.ots_episodes enable trigger ots_inventory_row;

select public.ots_inventory_rebuild();

truncate public.ots_episode_mcap_sizes;

commit;

-- Expect ego with its MCAP total, head_wrist with none:
select capture_setup,
       count(*)                                                as episodes,
       count(mcap_bytes)                                       as with_mcap_size,
       round(sum(stereo_bytes) / 1e12, 1)                      as video_tb,
       round(coalesce(sum(mcap_bytes), 0) / 1e12, 1)           as mcap_tb
  from public.ots_episodes
 group by 1;
