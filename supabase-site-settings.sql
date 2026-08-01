-- Run this in Supabase SQL Editor if the owner Top 100 visibility toggle says
-- it saved on this browser only.

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

create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.tornadoes
  add column if not exists wind_estimate integer;

alter table public.site_settings enable row level security;

grant select on public.site_settings to anon, authenticated;
grant insert, update, delete on public.site_settings to authenticated;

drop policy if exists "public read site settings" on public.site_settings;
create policy "public read site settings"
on public.site_settings
for select
using (true);

drop policy if exists "owners manage site settings" on public.site_settings;
create policy "owners manage site settings"
on public.site_settings
for all
using (public.utwx_is_owner(auth.uid()))
with check (public.utwx_is_owner(auth.uid()));

drop policy if exists "admins manage top 100 wind estimates" on public.site_settings;
create policy "admins manage top 100 wind estimates"
on public.site_settings
for all
using (
  key = 'top100_wind_estimates'
  and public.utwx_is_admin(auth.uid())
)
with check (
  key = 'top100_wind_estimates'
  and public.utwx_is_admin(auth.uid())
);

insert into public.site_settings (key, value, updated_at)
values ('top100_public_visible', '{"enabled": true}'::jsonb, now())
on conflict (key) do update
set value = excluded.value,
    updated_at = excluded.updated_at;

insert into public.site_settings (key, value, updated_at)
values ('top100_wind_estimates', '{"estimates": {}}'::jsonb, now())
on conflict (key) do nothing;

update public.tornadoes t
set wind_estimate = round(e.value::numeric)::integer
from jsonb_each_text(coalesce((
  select value -> 'estimates'
  from public.site_settings
  where key = 'top100_wind_estimates'
), '{}'::jsonb)) as e(id, value)
where t.id::text = e.id
  and e.value ~ '^[0-9]+(\.[0-9]+)?$';
