-- Run once in Supabase SQL Editor. Safe to rerun; originals are unchanged.
begin;

alter table public.tropical_cyclones
  add column if not exists thumbnail_fit text not null default 'cover',
  add column if not exists thumbnail_zoom numeric not null default 1,
  add column if not exists thumbnail_position text,
  add column if not exists cover_fit text not null default 'cover',
  add column if not exists cover_zoom numeric not null default 1;

alter table public.tropical_cyclones
  drop constraint if exists cyclone_thumbnail_fit_check,
  add constraint cyclone_thumbnail_fit_check check (thumbnail_fit in ('cover','contain')),
  drop constraint if exists cyclone_thumbnail_zoom_check,
  add constraint cyclone_thumbnail_zoom_check check (thumbnail_zoom between 0.25 and 2.5),
  drop constraint if exists cyclone_cover_fit_check,
  add constraint cyclone_cover_fit_check check (cover_fit in ('cover','contain')),
  drop constraint if exists cyclone_cover_zoom_check,
  add constraint cyclone_cover_zoom_check check (cover_zoom between 0.25 and 2.5);

alter table public.cyclone_uploads
  add column if not exists upload_fingerprint text,
  add column if not exists image_hash text,
  add column if not exists repeat_scan boolean not null default false,
  add column if not exists repeat_reason text;

notify pgrst, 'reload schema';
commit;
