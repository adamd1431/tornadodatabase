-- Run this once in Supabase SQL Editor to save index thumbnail fit/zoom settings.

alter table public.tornadoes
  add column if not exists thumbnail_fit text not null default 'cover',
  add column if not exists thumbnail_zoom numeric not null default 1,
  add column if not exists thumbnail_position text;

alter table public.tornadoes
  drop constraint if exists tornadoes_thumbnail_fit_check,
  add constraint tornadoes_thumbnail_fit_check
    check (thumbnail_fit in ('cover', 'contain'));

alter table public.tornadoes
  drop constraint if exists tornadoes_thumbnail_zoom_check,
  add constraint tornadoes_thumbnail_zoom_check
    check (thumbnail_zoom >= 1 and thumbnail_zoom <= 2.5);
