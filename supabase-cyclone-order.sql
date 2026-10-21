-- Run once in Supabase SQL Editor after supabase-tropical-cyclones.sql.
-- Safe to rerun. Adds owner-only ordering within each year for everyone.
begin;

alter table public.tropical_cyclones
  add column if not exists year_order integer not null default 0 check (year_order >= 0);

create or replace function public.utwx_guard_cyclone_year_order()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if ((tg_op = 'INSERT' and new.year_order <> 0)
      or (tg_op = 'UPDATE' and new.year_order is distinct from old.year_order))
    and not coalesce(public.utwx_is_owner(auth.uid()),false) then
    raise exception 'Only the owner can change cyclone order.' using errcode = '42501';
  end if;
  return new;
end; $$;
revoke all on function public.utwx_guard_cyclone_year_order() from public;
drop trigger if exists guard_cyclone_year_order on public.tropical_cyclones;
create trigger guard_cyclone_year_order before insert or update on public.tropical_cyclones
  for each row execute function public.utwx_guard_cyclone_year_order();

-- One transaction prevents partial reorders. Serialize moves and lock the year
-- so concurrent requests use the latest order without overwriting other edits.
create or replace function public.utwx_move_cyclone(p_cyclone_id uuid, p_neighbor_id uuid)
returns setof public.tropical_cyclones
language plpgsql security definer set search_path = public as $$
declare target_year integer; ids uuid[]; from_index integer; to_index integer;
begin
  if not coalesce(public.utwx_is_owner(auth.uid()),false) then
    raise exception 'Only the owner can change cyclone order.' using errcode = '42501';
  end if;
  if p_cyclone_id is null or p_neighbor_id is null or p_cyclone_id = p_neighbor_id then
    raise exception 'Choose two different cyclones in the same year.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('utwx:cyclone-year-order'));
  select c.year into target_year from public.tropical_cyclones c
    where c.id = p_cyclone_id and c.status <> 'rejected';
  perform 1 from public.tropical_cyclones c where c.year = target_year order by c.id for update;
  select array_agg(c.id order by c.year_order,c.id) into ids
    from public.tropical_cyclones c where c.year = target_year and c.status <> 'rejected';
  from_index := array_position(ids,p_cyclone_id);
  to_index := array_position(ids,p_neighbor_id);
  if from_index is null or to_index is null then
    raise exception 'These cyclones must still be in the same year. Refresh and try again.' using errcode = '22023';
  end if;
  ids[from_index] := p_neighbor_id;
  ids[to_index] := p_cyclone_id;
  return query update public.tropical_cyclones c set year_order = positions.position::integer
    from unnest(ids) with ordinality as positions(id,position)
    where c.id = positions.id returning c.*;
end; $$;
revoke all on function public.utwx_move_cyclone(uuid,uuid) from public;
grant execute on function public.utwx_move_cyclone(uuid,uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
