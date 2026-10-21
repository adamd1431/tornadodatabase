-- Run once after supabase-tropical-cyclones.sql. Safe to rerun.
-- Eye temperature is optional. Existing records and approval rules are preserved.
begin;

alter table public.tropical_cyclones
  add column if not exists eye_temperature_c numeric;
alter table public.tropical_cyclones
  drop constraint if exists cyclone_eye_temperature_check,
  add constraint cyclone_eye_temperature_check
    check (eye_temperature_c between -150 and 100);

-- The optional final argument also accepts older five-argument submissions.
drop function if exists public.submit_tropical_cyclone(uuid,text,integer,numeric,numeric);
create or replace function public.submit_tropical_cyclone(p_id uuid, p_name text, p_year integer, p_peak_winds_mph numeric, p_lowest_pressure_mb numeric, p_eye_temperature_c numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare actor_name text; result public.tropical_cyclones;
begin
  select coalesce(nullif(btrim(username),''),'Member') into actor_name from public.profiles where id = auth.uid();
  insert into public.tropical_cyclones(id,name,year,peak_winds_mph,lowest_pressure_mb,eye_temperature_c,created_by,submitted_by,status)
    values(p_id,btrim(p_name),p_year,p_peak_winds_mph,p_lowest_pressure_mb,p_eye_temperature_c,auth.uid(),coalesce(actor_name,'Anonymous'),
      case when coalesce(public.utwx_is_admin(auth.uid()),false) then 'approved' else 'pending' end)
    on conflict(id) do nothing;
  select * into result from public.tropical_cyclones where id = p_id and created_by is not distinct from auth.uid();
  if result.id is null then raise exception 'This submission could not be saved. Please try again.'; end if;
  return jsonb_build_object('id',result.id,'status',result.status);
end; $$;
revoke all on function public.submit_tropical_cyclone(uuid,text,integer,numeric,numeric,numeric) from public;
grant execute on function public.submit_tropical_cyclone(uuid,text,integer,numeric,numeric,numeric) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
