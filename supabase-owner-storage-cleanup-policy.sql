-- Run this in Supabase SQL Editor if the Owner storage cleanup button
-- cannot list or remove unused files in either media bucket.
-- This grants only the existing Owner access; no files are deleted by this SQL.

alter table public.profiles
  add column if not exists username text,
  add column if not exists email text,
  add column if not exists role text default 'user',
  add column if not exists is_admin boolean not null default false;

create or replace function public.utwx_is_owner(check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    check_user_id = auth.uid()
    and lower(coalesce(auth.jwt() ->> 'email', '')) = 'lazerbuffalo1431@gmail.com'
  )
  or exists (
    select 1
    from public.profiles p
    where p.id = check_user_id
      and (
        lower(coalesce(p.role, '')) = 'owner'
        or lower(coalesce(p.email, '')) = 'lazerbuffalo1431@gmail.com'
      )
  );
$$;

grant usage on schema storage to authenticated;
grant select, delete on storage.objects to authenticated;

drop policy if exists "owners read uploads storage objects" on storage.objects;
create policy "owners read uploads storage objects"
on storage.objects
for select
to authenticated
using (
  bucket_id in ('uploads', 'cyclone-uploads')
  and public.utwx_is_owner(auth.uid())
);

drop policy if exists "owners delete uploads storage objects" on storage.objects;
create policy "owners delete uploads storage objects"
on storage.objects
for delete
to authenticated
using (
  bucket_id in ('uploads', 'cyclone-uploads')
  and public.utwx_is_owner(auth.uid())
);
