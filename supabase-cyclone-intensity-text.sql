-- Run after the cyclone designation, year-range, and owner-estimate migrations.
-- Keep numeric measurements for sorting/calculation; preserve nonnumeric input separately.
begin;
alter table public.tropical_cyclones
  alter column peak_winds_mph drop not null,
  alter column lowest_pressure_mb drop not null,
  add column if not exists peak_winds_mph_text text check (length(btrim(peak_winds_mph_text)) between 1 and 160),
  add column if not exists peak_winds_kts_text text check (length(btrim(peak_winds_kts_text)) between 1 and 160),
  add column if not exists lowest_pressure_mb_text text check (length(btrim(lowest_pressure_mb_text)) between 1 and 160),
  add column if not exists owner_estimated_winds_mph_text text check (length(btrim(owner_estimated_winds_mph_text)) between 1 and 160),
  add column if not exists owner_estimated_pressure_mb_text text check (length(btrim(owner_estimated_pressure_mb_text)) between 1 and 160);

-- Existing numeric clients/calculators must also clear any previous text label.
create or replace function public.utwx_normalize_cyclone_intensity()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.peak_winds_mph is not null then new.peak_winds_mph_text := null; new.peak_winds_kts_text := null; end if;
  if new.lowest_pressure_mb is not null then new.lowest_pressure_mb_text := null; end if;
  if new.owner_estimated_winds_mph is not null then new.owner_estimated_winds_mph_text := null; end if;
  if new.owner_estimated_pressure_mb is not null then new.owner_estimated_pressure_mb_text := null; end if;
  return new;
end; $$;
revoke all on function public.utwx_normalize_cyclone_intensity() from public;
create or replace trigger cyclone_intensity_cleanup before insert or update on public.tropical_cyclones
  for each row execute function public.utwx_normalize_cyclone_intensity();

-- Text owner estimates have exactly the same protection as numeric estimates.
create or replace function public.utwx_guard_cyclone_owner_estimates()
returns trigger language plpgsql security definer set search_path=public as $$
declare estimates_changed boolean;
begin
  if tg_op='INSERT' then
    estimates_changed := new.owner_estimated_winds_mph is not null or new.owner_estimated_pressure_mb is not null
      or new.owner_estimated_winds_mph_text is not null or new.owner_estimated_pressure_mb_text is not null;
  else
    estimates_changed := row(new.owner_estimated_winds_mph,new.owner_estimated_pressure_mb,new.owner_estimated_winds_mph_text,new.owner_estimated_pressure_mb_text)
      is distinct from row(old.owner_estimated_winds_mph,old.owner_estimated_pressure_mb,old.owner_estimated_winds_mph_text,old.owner_estimated_pressure_mb_text);
  end if;
  if estimates_changed and not coalesce(public.utwx_is_owner(auth.uid()),false) then
    raise exception 'Only the owner can edit cyclone estimates.' using errcode='42501';
  end if;
  return new;
end; $$;
revoke all on function public.utwx_guard_cyclone_owner_estimates() from public;

-- New endpoint leaves all existing numeric submission signatures intact.
create or replace function public.submit_tropical_cyclone_intensity(
  p_id uuid,p_name text,p_year integer,p_peak_winds_mph numeric default null,p_lowest_pressure_mb numeric default null,
  p_peak_winds_mph_text text default null,p_peak_winds_kts_text text default null,p_lowest_pressure_mb_text text default null,
  p_year_end integer default null,p_eye_temperature_c numeric default null,p_jtwc_designation text default null,p_basin text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor_name text; result public.tropical_cyclones;
begin
  select coalesce(nullif(btrim(username),''),'Member') into actor_name from public.profiles where id=auth.uid();
  insert into public.tropical_cyclones(id,name,year,year_end,peak_winds_mph,lowest_pressure_mb,peak_winds_mph_text,peak_winds_kts_text,lowest_pressure_mb_text,eye_temperature_c,jtwc_designation,basin,created_by,submitted_by,status)
    values(p_id,btrim(p_name),p_year,p_year_end,p_peak_winds_mph,p_lowest_pressure_mb,
      nullif(btrim(p_peak_winds_mph_text),''),nullif(btrim(p_peak_winds_kts_text),''),nullif(btrim(p_lowest_pressure_mb_text),''),
      p_eye_temperature_c,nullif(btrim(p_jtwc_designation),''),nullif(btrim(p_basin),''),auth.uid(),coalesce(actor_name,'Anonymous'),
      case when coalesce(public.utwx_is_admin(auth.uid()),false) then 'approved' else 'pending' end)
    on conflict(id) do nothing;
  select * into result from public.tropical_cyclones where id=p_id and created_by is not distinct from auth.uid();
  if result.id is null then raise exception 'This submission could not be confirmed. Please try again.'; end if;
  return jsonb_build_object('id',result.id,'status',result.status);
end; $$;
revoke all on function public.submit_tropical_cyclone_intensity(uuid,text,integer,numeric,numeric,text,text,text,integer,numeric,text,text) from public;
grant execute on function public.submit_tropical_cyclone_intensity(uuid,text,integer,numeric,numeric,text,text,text,integer,numeric,text,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
