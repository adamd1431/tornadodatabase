-- Run this in Supabase SQL Editor to save outbreak groups.

create extension if not exists pgcrypto;

create table if not exists public.outbreaks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  dates text[] not null default '{}',
  cover_tornado_id text,
  created_by uuid references auth.users(id) on delete set null
);

alter table public.outbreaks
  add column if not exists cover_tornado_id text;

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
using (true);

drop policy if exists "authenticated create outbreaks" on public.outbreaks;
create policy "authenticated create outbreaks"
on public.outbreaks
for insert
to authenticated
with check (created_by = auth.uid() or created_by is null);

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
