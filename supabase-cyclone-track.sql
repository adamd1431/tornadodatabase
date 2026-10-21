-- Run once in Supabase SQL Editor to enable the Track and Recon media tabs.
-- Safe to rerun. Existing files, categories, approvals, and permissions are kept.
begin;

alter table public.cyclone_uploads drop constraint if exists cyclone_uploads_category_check;
alter table public.cyclone_uploads add constraint cyclone_uploads_category_check
  check (category in ('photos','satellite','track','recon','damage','radar','models','misc',
                     'environment','research','text_accounts'));

commit;
