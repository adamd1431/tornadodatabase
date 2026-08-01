-- Run this in Supabase SQL Editor if image duplicate detection stops catching
-- repeated uploads reliably.

alter table public.uploads
  add column if not exists repeat_scan boolean not null default false,
  add column if not exists repeat_reason text,
  add column if not exists upload_fingerprint text,
  add column if not exists image_hash text;
