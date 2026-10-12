-- Run this in Supabase SQL Editor to let users track pending uploads,
-- cancel their own pending uploads, and receive approval/rejection notices.

create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists username text,
  add column if not exists email text,
  add column if not exists role text default 'user',
  add column if not exists is_admin boolean not null default false;

alter table public.uploads
  add column if not exists user_id uuid references auth.users(id) on delete set null;

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

create or replace function public.utwx_is_admin(check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.utwx_is_owner(check_user_id)
  or exists (
    select 1
    from public.profiles p
    where p.id = check_user_id
      and (
        p.is_admin is true
        or lower(coalesce(p.role, '')) in ('admin', 'owner')
        or lower(coalesce(p.email, '')) = 'lazerbuffalo1431@gmail.com'
      )
  );
$$;

create table if not exists public.upload_notifications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  upload_id text,
  tornado_id text,
  category text,
  decision text not null check (decision in ('approved', 'rejected')),
  title text not null,
  message text not null,
  file_url text,
  read_at timestamptz
);

alter table public.upload_notifications enable row level security;

grant select, update, delete on public.upload_notifications to authenticated;
grant insert on public.upload_notifications to authenticated;

drop policy if exists "users read own upload notifications" on public.upload_notifications;
create policy "users read own upload notifications"
on public.upload_notifications
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "users update own upload notifications" on public.upload_notifications;
create policy "users update own upload notifications"
on public.upload_notifications
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "users delete own upload notifications" on public.upload_notifications;
create policy "users delete own upload notifications"
on public.upload_notifications
for delete
to authenticated
using (user_id = auth.uid());

drop policy if exists "admins create upload notifications" on public.upload_notifications;
create policy "admins create upload notifications"
on public.upload_notifications
for insert
to authenticated
with check (public.utwx_is_admin(auth.uid()));

drop policy if exists "users read own pending uploads" on public.uploads;
create policy "users read own pending uploads"
on public.uploads
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "users cancel own pending uploads" on public.uploads;
create policy "users cancel own pending uploads"
on public.uploads
for delete
to authenticated
using (
  user_id = auth.uid()
  and status = 'pending'
);
