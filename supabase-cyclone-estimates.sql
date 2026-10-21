-- Run after supabase-tropical-cyclones.sql in Supabase SQL Editor. Safe to rerun.
-- Official winds and pressure stay unchanged; owner estimates are optional.
begin;

alter table public.tropical_cyclones
  add column if not exists owner_estimated_winds_mph numeric
    check (owner_estimated_winds_mph between 0 and 500),
  add column if not exists owner_estimated_pressure_mb numeric
    check (owner_estimated_pressure_mb > 0 and owner_estimated_pressure_mb <= 2000);

-- Admins can still review submissions and edit official details, but cannot
-- change either owner estimate through a direct API request or another form.
create or replace function public.utwx_guard_cyclone_owner_estimates()
returns trigger language plpgsql security definer set search_path = public as $$
declare estimates_changed boolean;
begin
  if tg_op = 'INSERT' then
    estimates_changed := new.owner_estimated_winds_mph is not null or new.owner_estimated_pressure_mb is not null;
  else
    estimates_changed := row(new.owner_estimated_winds_mph,new.owner_estimated_pressure_mb)
      is distinct from row(old.owner_estimated_winds_mph,old.owner_estimated_pressure_mb);
  end if;
  if estimates_changed and not coalesce(public.utwx_is_owner(auth.uid()),false) then
    raise exception 'Only the owner can edit cyclone estimates.' using errcode = '42501';
  end if;
  return new;
end; $$;

revoke all on function public.utwx_guard_cyclone_owner_estimates() from public;
drop trigger if exists guard_cyclone_owner_estimates on public.tropical_cyclones;
create trigger guard_cyclone_owner_estimates before insert or update on public.tropical_cyclones
  for each row execute function public.utwx_guard_cyclone_owner_estimates();

commit;
