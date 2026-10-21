create extension if not exists pgcrypto;

create table if not exists public.user_top100_lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  owner_name text not null default 'User',
  title text not null default 'My Top 100',
  description text not null default '',
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_top100_lists enable row level security;

drop policy if exists "user_top100_lists_select_public_or_owner" on public.user_top100_lists;
create policy "user_top100_lists_select_public_or_owner"
  on public.user_top100_lists
  for select
  using (visibility = 'public' or auth.uid() = owner_id);

drop policy if exists "user_top100_lists_insert_own" on public.user_top100_lists;
create policy "user_top100_lists_insert_own"
  on public.user_top100_lists
  for insert
  with check (auth.uid() = owner_id);

drop policy if exists "user_top100_lists_update_own" on public.user_top100_lists;
create policy "user_top100_lists_update_own"
  on public.user_top100_lists
  for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "user_top100_lists_delete_own" on public.user_top100_lists;
create policy "user_top100_lists_delete_own"
  on public.user_top100_lists
  for delete
  using (auth.uid() = owner_id);

create index if not exists user_top100_lists_owner_id_idx
  on public.user_top100_lists(owner_id);

create index if not exists user_top100_lists_visibility_updated_idx
  on public.user_top100_lists(visibility, updated_at desc);

-- Run once in the Supabase SQL editor. Safe to run again.
-- Existing rankings remain tornado lists, with their order and estimates intact.
alter table public.user_top100_lists
  add column if not exists list_type text not null default 'tornadoes';

alter table public.user_top100_lists drop constraint if exists user_top100_lists_type_check;
alter table public.user_top100_lists add constraint user_top100_lists_type_check
  check (list_type in ('tornadoes', 'cyclones'));

create or replace function public.validate_user_list_records()
returns trigger language plpgsql set search_path = public as $$
declare
  entry jsonb;
  record_id text;
  old_items jsonb := '[]'::jsonb;
  seen_ids text[] := array[]::text[];
  found_record boolean;
begin
  if tg_op = 'UPDATE' then
    if new.list_type is distinct from old.list_type then
      raise exception 'A list type cannot change. Create a new list for the other record type.';
    end if;
    old_items := old.items;
  end if;
  if jsonb_typeof(new.items) is distinct from 'array' then
    raise exception 'List entries must be an array.';
  end if;
  if jsonb_array_length(new.items) > 100 then
    raise exception 'A list can contain at most 100 entries.';
  end if;
  for entry in select value from jsonb_array_elements(new.items) loop
    record_id := case when jsonb_typeof(entry) = 'string' then entry #>> '{}' else entry ->> 'id' end;
    if record_id is null or btrim(record_id) = '' or record_id = any(seen_ids) then
      raise exception 'Each list entry must have a unique record ID.';
    end if;
    seen_ids := array_append(seen_ids, record_id);
    -- Keep unavailable historical entries editable/reorderable without losing them.
    if exists (
      select 1 from jsonb_array_elements(old_items) as previous(value)
      where (case when jsonb_typeof(value) = 'string' then value #>> '{}' else value ->> 'id' end) = record_id
    ) then continue; end if;
    if new.list_type = 'cyclones' then
      select exists(select 1 from public.tropical_cyclones where id::text = record_id and status = 'approved') into found_record;
    else
      select exists(select 1 from public.tornadoes where id::text = record_id and status = 'approved') into found_record;
    end if;
    if not found_record then
      raise exception 'Only approved records matching this list type can be added.';
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function public.validate_user_list_records() from public;
drop trigger if exists user_list_records_check on public.user_top100_lists;
create trigger user_list_records_check before insert or update of items, list_type
  on public.user_top100_lists for each row execute function public.validate_user_list_records();

grant select on public.user_top100_lists to anon, authenticated;
grant insert, update, delete on public.user_top100_lists to authenticated;
