-- OPTIONAL CLEANUP ONLY: the official cyclone Top 100 now reads owner wind
-- estimates directly from tropical_cyclones. No ranking setup is needed.
-- Run this only if the previous manual-ranking setup was installed.
-- Previous manual rankings are retained in their table; no storm data changes.
begin;
drop trigger if exists guard_official_cyclone_status on public.tropical_cyclones;
drop function if exists public.utwx_guard_official_cyclone_status();
drop function if exists public.utwx_save_official_cyclone_top100(jsonb,timestamptz);
drop function if exists public.utwx_can_edit_official_cyclone_top100();
commit;
