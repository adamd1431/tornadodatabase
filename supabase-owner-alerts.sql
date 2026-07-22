-- Run this in Supabase SQL Editor.
-- It enables owner activity alerts and pending username admin grants.

alter table public.profiles
  add column if not exists username text,
  add column if not exists email text,
  add column if not exists role text default 'user',
  add column if not exists is_admin boolean not null default false;

alter table public.profiles enable row level security;

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

drop policy if exists "users read own profile" on public.profiles;
create policy "users read own profile"
on public.profiles
for select
using (id = auth.uid());

drop policy if exists "owners read all profiles" on public.profiles;
create policy "owners read all profiles"
on public.profiles
for select
using (public.utwx_is_owner(auth.uid()));

drop policy if exists "users update own basic profile" on public.profiles;
create policy "users update own basic profile"
on public.profiles
for update
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "owners update any profile" on public.profiles;
create policy "owners update any profile"
on public.profiles
for update
using (public.utwx_is_owner(auth.uid()))
with check (public.utwx_is_owner(auth.uid()));

drop policy if exists "users insert own profile" on public.profiles;
create policy "users insert own profile"
on public.profiles
for insert
with check (id = auth.uid());

create or replace function public.utwx_guard_profile_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.utwx_is_owner(auth.uid()) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.is_admin, false) is true
       or lower(coalesce(new.role, 'user')) <> 'user' then
      raise exception 'Only owners can assign profile roles.';
    end if;
    return new;
  end if;

  if coalesce(new.is_admin, false) is distinct from coalesce(old.is_admin, false)
     or lower(coalesce(new.role, 'user')) is distinct from lower(coalesce(old.role, 'user')) then
    raise exception 'Only owners can assign profile roles.';
  end if;

  return new;
end;
$$;

drop trigger if exists utwx_guard_profile_role_change on public.profiles;
create trigger utwx_guard_profile_role_change
before insert or update on public.profiles
for each row
execute function public.utwx_guard_profile_role_change();

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
using (public.utwx_is_owner(auth.uid()))
with check (public.utwx_is_owner(auth.uid()));

drop policy if exists "admins create owner alerts" on public.owner_alerts;
create policy "admins create owner alerts"
on public.owner_alerts
for insert
with check (
  actor_id = auth.uid()
  and public.utwx_is_admin(auth.uid())
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
