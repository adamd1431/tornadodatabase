-- Run this in Supabase SQL Editor after supabase-user-upload-workflow.sql.
-- Approved outbreaks are public; member submissions wait for admin approval.
-- Existing outbreaks without a status enter the approval queue.

begin;

create extension if not exists pgcrypto;

create table if not exists public.outbreaks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  dates text[] not null default '{}',
  cover_tornado_id text,
  tornado_order text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_by uuid references auth.users(id) on delete set null
);

alter table public.outbreaks
  add column if not exists cover_tornado_id text;

alter table public.outbreaks
  add column if not exists tornado_order text[] not null default '{}';

alter table public.outbreaks
  add column if not exists status text not null default 'pending';

alter table public.outbreaks drop constraint if exists outbreaks_status_check;
alter table public.outbreaks add constraint outbreaks_status_check
  check (status in ('pending', 'approved', 'rejected'));

create index if not exists outbreaks_status_created_at_idx
  on public.outbreaks(status, created_at desc);

create index if not exists outbreaks_created_at_idx
  on public.outbreaks(created_at desc);

create index if not exists outbreaks_dates_idx
  on public.outbreaks using gin(dates);

create or replace function public.utwx_touch_outbreaks_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists utwx_touch_outbreaks_updated_at on public.outbreaks;
create trigger utwx_touch_outbreaks_updated_at
before update on public.outbreaks
for each row
execute function public.utwx_touch_outbreaks_updated_at();

alter table public.outbreaks enable row level security;

grant select on public.outbreaks to anon, authenticated;
grant insert, update, delete on public.outbreaks to authenticated;

drop policy if exists "public read outbreaks" on public.outbreaks;
create policy "public read outbreaks"
on public.outbreaks
for select
to anon, authenticated
using (
  status = 'approved'
  or created_by = auth.uid()
  or public.utwx_is_admin(auth.uid())
);

drop policy if exists "authenticated create outbreaks" on public.outbreaks;
create policy "authenticated create outbreaks"
on public.outbreaks
for insert
to authenticated
with check (
  created_by = auth.uid()
  and (status = 'pending' or (status = 'approved' and public.utwx_is_admin(auth.uid())))
);

drop policy if exists "admins update outbreaks" on public.outbreaks;
create policy "admins update outbreaks"
on public.outbreaks
for update
to authenticated
using (public.utwx_is_admin(auth.uid()))
with check (public.utwx_is_admin(auth.uid()));

drop policy if exists "admins delete outbreaks" on public.outbreaks;
create policy "admins delete outbreaks"
on public.outbreaks
for delete
to authenticated
using (public.utwx_is_admin(auth.uid()));

commit;
