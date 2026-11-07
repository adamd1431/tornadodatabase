-- Run after supabase-cyclone-eye-temperature.sql. Safe to rerun.
-- Adds optional generator metadata without changing existing storm values or approval rules.
begin;

alter table public.tropical_cyclones
  add column if not exists jtwc_designation text,
  add column if not exists basin text;
alter table public.tropical_cyclones
  drop constraint if exists cyclone_jtwc_designation_check,
  add constraint cyclone_jtwc_designation_check check (length(btrim(jtwc_designation)) between 1 and 80),
  drop constraint if exists cyclone_basin_check,
  add constraint cyclone_basin_check check (length(btrim(basin)) between 1 and 80);

-- Keep older clients working through default arguments, with a single RPC overload.
drop function if exists public.submit_tropical_cyclone(uuid,text,integer,numeric,numeric);
drop function if exists public.submit_tropical_cyclone(uuid,text,integer,numeric,numeric,numeric);
create or replace function public.submit_tropical_cyclone(
  p_id uuid, p_name text, p_year integer, p_peak_winds_mph numeric, p_lowest_pressure_mb numeric,
  p_eye_temperature_c numeric default null, p_jtwc_designation text default null, p_basin text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare actor_name text; result public.tropical_cyclones;
begin
  select coalesce(nullif(btrim(username),''),'Member') into actor_name from public.profiles where id = auth.uid();
  insert into public.tropical_cyclones(id,name,year,peak_winds_mph,lowest_pressure_mb,eye_temperature_c,jtwc_designation,basin,created_by,submitted_by,status)
    values(p_id,btrim(p_name),p_year,p_peak_winds_mph,p_lowest_pressure_mb,p_eye_temperature_c,
      nullif(btrim(p_jtwc_designation),''),nullif(btrim(p_basin),''),auth.uid(),coalesce(actor_name,'Anonymous'),
      case when coalesce(public.utwx_is_admin(auth.uid()),false) then 'approved' else 'pending' end)
    on conflict(id) do nothing;
  select * into result from public.tropical_cyclones where id = p_id and created_by is not distinct from auth.uid();
  if result.id is null then raise exception 'This submission could not be saved. Please try again.'; end if;
  return jsonb_build_object('id',result.id,'status',result.status);
end; $$;
revoke all on function public.submit_tropical_cyclone(uuid,text,integer,numeric,numeric,numeric,text,text) from public;
grant execute on function public.submit_tropical_cyclone(uuid,text,integer,numeric,numeric,numeric,text,text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
