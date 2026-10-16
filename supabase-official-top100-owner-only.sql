-- Run once in the Supabase SQL editor to enforce owner-only official Top 100 edits.
-- Keeps existing rankings, viewer access, other admin edits, and personal lists.
-- The owner is checked against the authenticated account, not editable profile fields.

begin;

alter table public.tornadoes
  add column if not exists opinion_rank integer,
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

create or replace function public.utwx_can_edit_official_top100()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and lower(btrim(u.email)) = 'lazerbuffalo1431@gmail.com'
  );
$$;
revoke all on function public.utwx_can_edit_official_top100() from public;
grant execute on function public.utwx_can_edit_official_top100() to authenticated;

-- Triggers also protect these fields when old permissive admin policies or
-- security-definer RPCs allow updates to the rest of a tornado or setting row.
create or replace function public.utwx_guard_official_top100()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  protected_change boolean := false;
  caller_role text := current_setting('role',true);
begin
  -- Keep trusted server maintenance and SQL-editor migrations working.
  if caller_role in ('service_role','postgres','supabase_admin')
     or (caller_role = 'none' and session_user in ('postgres','supabase_admin')) then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_table_name = 'tornadoes' then
    if tg_op = 'INSERT' then
      protected_change := new.opinion_rank between 1 and 100 or new.wind_estimate is not null;
    elsif tg_op = 'DELETE' then
      protected_change := old.opinion_rank between 1 and 100;
    else
      protected_change := new.opinion_rank is distinct from old.opinion_rank
        or new.wind_estimate is distinct from old.wind_estimate
        or (old.opinion_rank between 1 and 100 and new.status is distinct from old.status);
    end if;
  elsif tg_table_name = 'site_settings' then
    if tg_op = 'INSERT' then
      protected_change := new.key in ('top100_wind_estimates','top100_public_visible');
    elsif tg_op = 'DELETE' then
      protected_change := old.key in ('top100_wind_estimates','top100_public_visible');
    else
      protected_change := old.key in ('top100_wind_estimates','top100_public_visible')
        or new.key in ('top100_wind_estimates','top100_public_visible');
    end if;
  end if;

  if protected_change and not public.utwx_can_edit_official_top100() then
    raise exception using errcode = '42501', message = 'Only the owner can edit the official Top 100.';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function public.utwx_guard_official_top100() from public;

drop trigger if exists utwx_guard_official_top100 on public.tornadoes;
create trigger utwx_guard_official_top100
before insert or update or delete on public.tornadoes
for each row execute function public.utwx_guard_official_top100();

drop trigger if exists utwx_guard_official_top100 on public.site_settings;
create trigger utwx_guard_official_top100
before insert or update or delete on public.site_settings
for each row execute function public.utwx_guard_official_top100();

drop policy if exists "admins manage top 100 wind estimates" on public.site_settings;
drop policy if exists "owners manage top 100 wind estimates" on public.site_settings;
drop policy if exists "owners manage official top 100 settings" on public.site_settings;
create policy "owners manage official top 100 settings"
on public.site_settings for all to authenticated
using (key in ('top100_wind_estimates','top100_public_visible') and public.utwx_can_edit_official_top100())
with check (key in ('top100_wind_estimates','top100_public_visible') and public.utwx_can_edit_official_top100());

drop policy if exists "public read official top 100 settings" on public.site_settings;
create policy "public read official top 100 settings"
on public.site_settings for select to anon, authenticated
using (key in ('top100_wind_estimates','top100_public_visible'));

commit;
