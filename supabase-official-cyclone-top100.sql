-- Run once after supabase-tropical-cyclones.sql.
-- Safe to rerun. This creates a separate ranking; existing lists are unchanged.
begin;

create table if not exists public.official_cyclone_top100 (
  id boolean primary key default true check (id),
  ranks jsonb not null default '{}'::jsonb check (jsonb_typeof(ranks) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.official_cyclone_top100 enable row level security;
revoke all on public.official_cyclone_top100 from public, anon, authenticated;
grant select on public.official_cyclone_top100 to anon, authenticated;
drop policy if exists official_cyclone_top100_read on public.official_cyclone_top100;
create policy official_cyclone_top100_read on public.official_cyclone_top100
  for select to anon, authenticated using (true);

insert into public.official_cyclone_top100 (id) values (true) on conflict (id) do nothing;

create or replace function public.utwx_can_edit_official_cyclone_top100()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from auth.users where id = auth.uid()
    and lower(btrim(email)) = 'lazerbuffalo1431@gmail.com');
$$;
revoke all on function public.utwx_can_edit_official_cyclone_top100() from public, anon;
grant execute on function public.utwx_can_edit_official_cyclone_top100() to authenticated;

-- A single transaction validates and saves the entire ranking. No client can
-- directly modify the table, including admins who are not the site owner.
create or replace function public.utwx_save_official_cyclone_top100(
  p_ranks jsonb, p_expected_updated_at timestamptz
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  saved public.official_cyclone_top100;
  entry record;
  entry_rank integer;
  used_ranks integer[] := array[]::integer[];
  used_ids uuid[] := array[]::uuid[];
begin
  if not public.utwx_can_edit_official_cyclone_top100() then
    raise exception 'Only the owner can edit the official tropical cyclone Top 100.' using errcode = '42501';
  end if;
  select * into saved from public.official_cyclone_top100 where id = true for update;
  if not found then raise exception 'The official cyclone ranking has not been initialized.'; end if;
  if p_expected_updated_at is null or saved.updated_at is distinct from p_expected_updated_at then
    raise exception 'The ranking changed. Refresh before editing again.' using errcode = '40001';
  end if;
  if p_ranks is null or jsonb_typeof(p_ranks) is distinct from 'object' then
    raise exception 'Rankings must be an object.' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_each(p_ranks)) > 100 then
    raise exception 'The official list can contain at most 100 tropical cyclones.' using errcode = '22023';
  end if;
  for entry in select * from jsonb_each(p_ranks) loop
    if entry.key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(entry.value) is distinct from 'number'
       or entry.value::text !~ '^([1-9][0-9]?|100)$' then
      raise exception 'Each cyclone needs a valid ID and an integer rank from 1 to 100.' using errcode = '22023';
    end if;
    entry_rank := entry.value::text::integer;
    if entry.key::uuid = any(used_ids) then
      raise exception 'Each tropical cyclone can appear only once.' using errcode = '22023';
    end if;
    used_ids := array_append(used_ids, entry.key::uuid);
    if entry_rank = any(used_ranks) then
      raise exception 'Each rank can contain only one tropical cyclone.' using errcode = '22023';
    end if;
    used_ranks := array_append(used_ranks, entry_rank);
    if not exists(select 1 from public.tropical_cyclones where id = entry.key::uuid and status = 'approved') then
      raise exception 'Only approved tropical cyclones can be ranked.' using errcode = '22023';
    end if;
  end loop;
  update public.official_cyclone_top100 set ranks = p_ranks,
    updated_at = clock_timestamp(), updated_by = auth.uid()
    where id = true returning * into saved;
  return jsonb_build_object('ranks', saved.ranks, 'updated_at', saved.updated_at);
end;
$$;
revoke all on function public.utwx_save_official_cyclone_top100(jsonb,timestamptz) from public, anon;
grant execute on function public.utwx_save_official_cyclone_top100(jsonb,timestamptz) to authenticated;

-- Moderating an already ranked record must not let another admin change the
-- official list's visible membership by changing its approval status.
create or replace function public.utwx_guard_official_cyclone_status()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if current_setting('role',true) in ('service_role','postgres','supabase_admin')
     or (current_setting('role',true) = 'none' and session_user in ('postgres','supabase_admin')) then return new; end if;
  if new.status is distinct from old.status and exists (
    select 1 from public.official_cyclone_top100,
      lateral jsonb_object_keys(ranks) as ranked(cyclone_id)
    where lower(ranked.cyclone_id) = old.id::text
  ) and not public.utwx_can_edit_official_cyclone_top100() then
    raise exception 'Only the owner can change the status of an officially ranked cyclone.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.utwx_guard_official_cyclone_status() from public, anon, authenticated;
drop trigger if exists guard_official_cyclone_status on public.tropical_cyclones;
create trigger guard_official_cyclone_status before update of status on public.tropical_cyclones
  for each row execute function public.utwx_guard_official_cyclone_status();

commit;
