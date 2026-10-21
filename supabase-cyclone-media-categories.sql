-- Run once in Supabase SQL Editor for an existing cyclone installation.
-- Safe to rerun. Retired categories move to Misc; files and approvals are kept.
begin;

alter table public.cyclone_uploads drop constraint if exists cyclone_uploads_category_check;

update public.cyclone_uploads
set category = 'misc'
where category in ('environment','research','text_accounts');

alter table public.cyclone_uploads add constraint cyclone_uploads_category_check
  check (category in ('photos','satellite','track','recon','damage','radar','models','misc'));

commit;
