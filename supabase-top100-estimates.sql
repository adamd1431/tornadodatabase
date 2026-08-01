-- Run this in Supabase SQL Editor if Top 100 estimates show for owner/admin
-- but not for non-admin viewers.

alter table public.tornadoes
  add column if not exists wind_estimate integer;

create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.site_settings enable row level security;

grant select on public.site_settings to anon, authenticated;
grant insert, update, delete on public.site_settings to authenticated;

drop policy if exists "public read site settings" on public.site_settings;
create policy "public read site settings"
on public.site_settings
for select
using (true);

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
