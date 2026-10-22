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

create or replace function public.utwx_guard_outbreak_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare outbreak_day text; parsed_day date; old_content jsonb; new_content jsonb;
begin
  if tg_op = 'UPDATE' then
    old_content := to_jsonb(old) - array['status','updated_at'];
    new_content := to_jsonb(new) - array['status','updated_at'];
    -- Preserve ON DELETE SET NULL when an author deletes their account.
    if old.created_by is not null and new.created_by is null
       and not exists (select 1 from auth.users where id = old.created_by) then
      old_content := old_content - 'created_by';
      new_content := new_content - 'created_by';
    end if;
    if new_content is distinct from old_content
       and not coalesce(public.utwx_is_owner(auth.uid()), false) then
      raise exception 'Only the owner can edit outbreak information or days.' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'INSERT' or new.name is distinct from old.name or new.dates is distinct from old.dates then
    if new.name is null or btrim(new.name) = '' then
      raise exception 'Enter an outbreak name.' using errcode = '22023';
    end if;
    if coalesce(cardinality(new.dates), 0) = 0 or array_ndims(new.dates) <> 1 then
      raise exception 'Choose at least one day for the outbreak.' using errcode = '22023';
    end if;
    foreach outbreak_day in array new.dates loop
      if outbreak_day is null or outbreak_day !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'Choose a valid calendar day.' using errcode = '22023';
      end if;
      begin
        parsed_day := outbreak_day::date;
      exception when others then
        raise exception 'Choose a valid calendar day.' using errcode = '22023';
      end;
      if to_char(parsed_day, 'YYYY-MM-DD') <> outbreak_day then
        raise exception 'Choose a valid calendar day.' using errcode = '22023';
      end if;
    end loop;
    new.name := btrim(new.name);
    select array_agg(distinct day order by day) into new.dates from unnest(new.dates) as days(day);
  end if;
  -- Days need no tornado or upload records. Removing a date only changes this grouping.
  return new;
end;
$$;

revoke all on function public.utwx_guard_outbreak_changes() from public;
drop trigger if exists utwx_guard_outbreak_changes on public.outbreaks;
create trigger utwx_guard_outbreak_changes
before insert or update on public.outbreaks
for each row execute function public.utwx_guard_outbreak_changes();

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
using (public.utwx_is_owner(auth.uid()) or public.utwx_is_admin(auth.uid()))
with check (public.utwx_is_owner(auth.uid()) or public.utwx_is_admin(auth.uid()));

drop policy if exists "admins delete outbreaks" on public.outbreaks;
drop policy if exists "owner deletes outbreaks" on public.outbreaks;
create policy "owner deletes outbreaks"
on public.outbreaks
for delete
to authenticated
using (public.utwx_is_owner(auth.uid()));

-- Make the new table available to the website's REST API after commit.
notify pgrst, 'reload schema';

commit;
