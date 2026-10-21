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
