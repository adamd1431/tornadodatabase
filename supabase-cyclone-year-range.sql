-- Optional ending year; existing numeric years, approval and row policies remain.
begin;
alter table public.tropical_cyclones add column if not exists year_end integer;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.tropical_cyclones'::regclass and conname='cyclone_year_end_check') then
    alter table public.tropical_cyclones add constraint cyclone_year_end_check
      check(year_end is null or (year_end > year and year_end <= 9999));
  end if;
end; $$;

-- A distinct endpoint preserves every existing single-year client/signature.
create or replace function public.submit_tropical_cyclone_range(
  p_id uuid,p_name text,p_year integer,p_year_end integer,
  p_peak_winds_mph numeric,p_lowest_pressure_mb numeric,
  p_eye_temperature_c numeric default null,p_jtwc_designation text default null,p_basin text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor_name text; result public.tropical_cyclones;
begin
  if p_year_end is null or p_year_end <= p_year or p_year_end > 9999 then
    raise exception 'Enter an ending year after the starting year, up to 9999.' using errcode='22023';
  end if;
  select coalesce(nullif(btrim(username),''),'Member') into actor_name from public.profiles where id=auth.uid();
  insert into public.tropical_cyclones(id,name,year,year_end,peak_winds_mph,lowest_pressure_mb,eye_temperature_c,jtwc_designation,basin,created_by,submitted_by,status)
    values(p_id,btrim(p_name),p_year,p_year_end,p_peak_winds_mph,p_lowest_pressure_mb,p_eye_temperature_c,
      nullif(btrim(p_jtwc_designation),''),nullif(btrim(p_basin),''),auth.uid(),coalesce(actor_name,'Anonymous'),
      case when coalesce(public.utwx_is_admin(auth.uid()),false) then 'approved' else 'pending' end)
    on conflict(id) do nothing;
  select * into result from public.tropical_cyclones where id=p_id and created_by is not distinct from auth.uid();
  if result.id is null or result.year <> p_year or result.year_end is distinct from p_year_end then
    raise exception 'This submission could not be confirmed. Please try again.';
  end if;
  return jsonb_build_object('id',result.id,'status',result.status);
end; $$;
revoke all on function public.submit_tropical_cyclone_range(uuid,text,integer,integer,numeric,numeric,numeric,text,text) from public;
grant execute on function public.submit_tropical_cyclone_range(uuid,text,integer,integer,numeric,numeric,numeric,text,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
