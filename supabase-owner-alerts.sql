-- Run this in Supabase SQL Editor.
-- It enables owner activity alerts and pending username admin grants.

alter table public.profiles
  add column if not exists username text,
  add column if not exists email text,
  add column if not exists role text default 'user',
  add column if not exists is_admin boolean not null default false;

create table if not exists public.owner_alerts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  actor_name text,
  action text not null,
  target_table text,
  target_id text,
  target_label text,
  before_data jsonb,
  after_data jsonb,
  status text not null default 'pending'
);

alter table public.owner_alerts enable row level security;

drop policy if exists "owners manage owner alerts" on public.owner_alerts;
create policy "owners manage owner alerts"
on public.owner_alerts
for all
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        lower(coalesce(p.role, '')) = 'owner'
        or lower(coalesce(p.email, '')) = 'lazerbuffalo1431@gmail.com'
      )
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        lower(coalesce(p.role, '')) = 'owner'
        or lower(coalesce(p.email, '')) = 'lazerbuffalo1431@gmail.com'
      )
  )
);

drop policy if exists "admins create owner alerts" on public.owner_alerts;
create policy "admins create owner alerts"
on public.owner_alerts
for insert
with check (
  actor_id = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.is_admin is true
        or lower(coalesce(p.role, '')) in ('admin', 'owner')
        or lower(coalesce(p.email, '')) = 'lazerbuffalo1431@gmail.com'
      )
  )
);

drop policy if exists "authenticated read pending username grants" on public.owner_alerts;
create policy "authenticated read pending username grants"
on public.owner_alerts
for select
using (
  auth.role() = 'authenticated'
  and status = 'pending_grant'
);

drop policy if exists "users mark their pending grants applied" on public.owner_alerts;
create policy "users mark their pending grants applied"
on public.owner_alerts
for update
using (
  auth.role() = 'authenticated'
  and status = 'pending_grant'
)
with check (
  auth.role() = 'authenticated'
  and status = 'applied'
  and target_id = auth.uid()::text
);