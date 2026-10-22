-- Run in Supabase SQL Editor after supabase-outbreaks.sql. Safe to rerun.
-- Content belongs to the site owner; admins may still approve or reject.
begin;

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

drop policy if exists "admins update outbreaks" on public.outbreaks;
create policy "admins update outbreaks" on public.outbreaks
for update to authenticated
using (public.utwx_is_owner(auth.uid()) or public.utwx_is_admin(auth.uid()))
with check (public.utwx_is_owner(auth.uid()) or public.utwx_is_admin(auth.uid()));

notify pgrst, 'reload schema';
commit;

