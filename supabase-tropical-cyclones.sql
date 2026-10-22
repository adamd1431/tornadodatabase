-- Run once in Supabase SQL Editor after supabase-user-upload-workflow.sql.
-- Safe to rerun. Tornado tables, rankings, and uploads are unchanged.
begin;

create table if not exists public.tropical_cyclones (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (length(btrim(name)) between 1 and 160),
  year integer not null check (year between 1 and 9999),
  peak_winds_mph numeric not null check (peak_winds_mph between 0 and 500),
  lowest_pressure_mb numeric not null check (lowest_pressure_mb > 0 and lowest_pressure_mb <= 2000),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_by uuid references auth.users(id) on delete set null,
  submitted_by text not null default 'Anonymous',
  description text not null default '',
  cover_image text,
  cover_position text default '50% 50%'
);

create table if not exists public.cyclone_uploads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  cyclone_id uuid not null references public.tropical_cyclones(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  uploaded_by text not null,
  file_url text not null check (file_url ~ '^https://[^/]+/storage/v1/object/public/cyclone-uploads/'),
  storage_path text not null,
  filename text not null,
  mime_type text not null,
  category text not null check (category in ('photos','satellite','track','recon','research','damage','radar','models','misc')),
  status text not null default 'pending' check (status in ('pending','approved','rejected'))
);

create table if not exists public.cyclone_summaries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  cyclone_id uuid not null references public.tropical_cyclones(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  submitted_by text not null,
  summary_text text not null check (length(btrim(summary_text)) between 1 and 20000),
  status text not null default 'pending' check (status in ('pending','approved','rejected'))
);

create index if not exists tropical_cyclones_status_year_idx on public.tropical_cyclones(status, year desc);
create index if not exists cyclone_uploads_cyclone_status_idx on public.cyclone_uploads(cyclone_id, status, created_at desc);
create index if not exists cyclone_summaries_status_idx on public.cyclone_summaries(status, created_at desc);

alter table public.tropical_cyclones enable row level security;
alter table public.cyclone_uploads enable row level security;
alter table public.cyclone_summaries enable row level security;
grant select on public.tropical_cyclones, public.cyclone_uploads, public.cyclone_summaries to anon, authenticated;
grant update, delete on public.tropical_cyclones to authenticated;
grant insert, update, delete on public.cyclone_uploads, public.cyclone_summaries to authenticated;

drop policy if exists cyclone_read on public.tropical_cyclones;
create policy cyclone_read on public.tropical_cyclones for select to anon, authenticated
  using (status = 'approved' or created_by = auth.uid() or public.utwx_is_admin(auth.uid()));
drop policy if exists cyclone_admin_edit on public.tropical_cyclones;
create policy cyclone_admin_edit on public.tropical_cyclones for update to authenticated
  using (public.utwx_is_admin(auth.uid())) with check (public.utwx_is_admin(auth.uid()));
drop policy if exists cyclone_admin_delete on public.tropical_cyclones;
drop policy if exists cyclone_owner_delete on public.tropical_cyclones;
create policy cyclone_owner_delete on public.tropical_cyclones for delete to authenticated using (public.utwx_is_owner(auth.uid()));

drop policy if exists cyclone_upload_read on public.cyclone_uploads;
create policy cyclone_upload_read on public.cyclone_uploads for select to anon, authenticated using (
  public.utwx_is_admin(auth.uid()) or user_id = auth.uid() or
  (status = 'approved' and exists(select 1 from public.tropical_cyclones c where c.id = cyclone_id and c.status = 'approved'))
);
drop policy if exists cyclone_upload_submit on public.cyclone_uploads;
create policy cyclone_upload_submit on public.cyclone_uploads for insert to authenticated with check (
  user_id = auth.uid() and (status = 'pending' or (status = 'approved' and public.utwx_is_admin(auth.uid())))
  and storage_path like auth.uid()::text || '/' || cyclone_id::text || '/%'
  and exists(select 1 from public.tropical_cyclones c where c.id = cyclone_id and (c.status = 'approved' or c.created_by = auth.uid() or public.utwx_is_admin(auth.uid())))
);
drop policy if exists cyclone_upload_edit on public.cyclone_uploads;
create policy cyclone_upload_edit on public.cyclone_uploads for update to authenticated
  using (public.utwx_is_admin(auth.uid())) with check (public.utwx_is_admin(auth.uid()));
drop policy if exists cyclone_upload_delete on public.cyclone_uploads;
create policy cyclone_upload_delete on public.cyclone_uploads for delete to authenticated
  using (public.utwx_is_admin(auth.uid()) or (user_id = auth.uid() and status = 'pending'));

drop policy if exists cyclone_summary_read on public.cyclone_summaries;
create policy cyclone_summary_read on public.cyclone_summaries for select to anon, authenticated
  using (user_id = auth.uid() or public.utwx_is_admin(auth.uid()));
drop policy if exists cyclone_summary_submit on public.cyclone_summaries;
create policy cyclone_summary_submit on public.cyclone_summaries for insert to authenticated with check (
  user_id = auth.uid() and (status = 'pending' or (status = 'approved' and public.utwx_is_admin(auth.uid())))
  and exists(select 1 from public.tropical_cyclones c where c.id = cyclone_id and (c.status = 'approved' or c.created_by = auth.uid() or public.utwx_is_admin(auth.uid())))
);
drop policy if exists cyclone_summary_edit on public.cyclone_summaries;
create policy cyclone_summary_edit on public.cyclone_summaries for update to authenticated
  using (public.utwx_is_admin(auth.uid())) with check (public.utwx_is_admin(auth.uid()));
drop policy if exists cyclone_summary_delete on public.cyclone_summaries;
create policy cyclone_summary_delete on public.cyclone_summaries for delete to authenticated
  using (public.utwx_is_admin(auth.uid()) or (user_id = auth.uid() and status = 'pending'));

-- Guest submissions use this RPC so pending records do not need public SELECT access.
-- Reusing the request UUID makes retrying an interrupted submission safe.
alter table public.tropical_cyclones
  add column if not exists eye_temperature_c numeric;
alter table public.tropical_cyclones
  drop constraint if exists cyclone_eye_temperature_check,
  add constraint cyclone_eye_temperature_check
    check (eye_temperature_c between -150 and 100);

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

create or replace function public.utwx_stamp_cyclone_contributor()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor_name text;
begin
  select coalesce(nullif(btrim(username),''),'Member') into actor_name from public.profiles where id = auth.uid();
  if tg_table_name = 'cyclone_uploads' then new.uploaded_by := coalesce(actor_name,'Member');
  else new.submitted_by := coalesce(actor_name,'Member'); end if;
  return new;
end; $$;
drop trigger if exists stamp_cyclone_upload_contributor on public.cyclone_uploads;
create trigger stamp_cyclone_upload_contributor before insert on public.cyclone_uploads for each row execute function public.utwx_stamp_cyclone_contributor();
drop trigger if exists stamp_cyclone_summary_contributor on public.cyclone_summaries;
create trigger stamp_cyclone_summary_contributor before insert on public.cyclone_summaries for each row execute function public.utwx_stamp_cyclone_contributor();

create or replace function public.utwx_publish_cyclone_summary()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    update public.tropical_cyclones set description = new.summary_text where id = new.cyclone_id;
  end if;
  return new;
end; $$;
drop trigger if exists publish_cyclone_summary on public.cyclone_summaries;
create trigger publish_cyclone_summary after insert or update of status on public.cyclone_summaries
  for each row execute function public.utwx_publish_cyclone_summary();

create or replace function public.utwx_cyclone_decision_notice()
returns trigger language plpgsql security definer set search_path = public as $$
declare recipient uuid; cyclone_name text; item_label text;
begin
  if old.status <> 'pending' or new.status not in ('approved','rejected') then return new; end if;
  if tg_table_name = 'tropical_cyclones' then
    recipient := new.created_by; cyclone_name := new.name; item_label := 'Tropical cyclone submission';
  else
    recipient := new.user_id;
    select name into cyclone_name from public.tropical_cyclones where id = new.cyclone_id;
    item_label := case when tg_table_name = 'cyclone_uploads' then 'Tropical cyclone upload' else 'Tropical cyclone summary' end;
  end if;
  if recipient is not null and recipient is distinct from auth.uid() then
    insert into public.upload_notifications(user_id,decision,title,message)
      values(recipient,new.status,item_label || case when new.status = 'approved' then ' approved' else ' declined' end,
        'Your submission for ' || coalesce(cyclone_name,'this tropical cyclone') || case when new.status = 'approved' then ' was accepted.' else ' was declined.' end);
  end if;
  return new;
end; $$;
drop trigger if exists cyclone_decision_notice on public.tropical_cyclones;
create trigger cyclone_decision_notice after update of status on public.tropical_cyclones for each row execute function public.utwx_cyclone_decision_notice();
drop trigger if exists cyclone_upload_decision_notice on public.cyclone_uploads;
create trigger cyclone_upload_decision_notice after update of status on public.cyclone_uploads for each row execute function public.utwx_cyclone_decision_notice();
drop trigger if exists cyclone_summary_decision_notice on public.cyclone_summaries;
create trigger cyclone_summary_decision_notice after update of status on public.cyclone_summaries for each row execute function public.utwx_cyclone_decision_notice();

insert into storage.buckets(id,name,public,file_size_limit)
  values('cyclone-uploads','cyclone-uploads',true,52428800) on conflict(id) do nothing;
grant select, insert, delete on storage.objects to authenticated;
drop policy if exists cyclone_storage_submit on storage.objects;
create policy cyclone_storage_submit on storage.objects for insert to authenticated
  with check (bucket_id = 'cyclone-uploads' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists cyclone_storage_read on storage.objects;
create policy cyclone_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'cyclone-uploads' and ((storage.foldername(name))[1] = auth.uid()::text or public.utwx_is_admin(auth.uid())));
drop policy if exists cyclone_storage_delete on storage.objects;
create policy cyclone_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'cyclone-uploads' and (public.utwx_is_admin(auth.uid()) or (
    (storage.foldername(name))[1] = auth.uid()::text
    and not exists(select 1 from public.cyclone_uploads u where u.storage_path = name and u.status = 'approved')
  )));

-- Crop settings and duplicate-scan metadata.


alter table public.tropical_cyclones
  add column if not exists thumbnail_fit text not null default 'cover',
  add column if not exists thumbnail_zoom numeric not null default 1,
  add column if not exists thumbnail_position text,
  add column if not exists cover_fit text not null default 'cover',
  add column if not exists cover_zoom numeric not null default 1;

alter table public.tropical_cyclones
  drop constraint if exists cyclone_thumbnail_fit_check,
  add constraint cyclone_thumbnail_fit_check check (thumbnail_fit in ('cover','contain')),
  drop constraint if exists cyclone_thumbnail_zoom_check,
  add constraint cyclone_thumbnail_zoom_check check (thumbnail_zoom between 0.25 and 2.5),
  drop constraint if exists cyclone_cover_fit_check,
  add constraint cyclone_cover_fit_check check (cover_fit in ('cover','contain')),
  drop constraint if exists cyclone_cover_zoom_check,
  add constraint cyclone_cover_zoom_check check (cover_zoom between 0.25 and 2.5);

alter table public.cyclone_uploads
  add column if not exists upload_fingerprint text,
  add column if not exists image_hash text,
  add column if not exists repeat_scan boolean not null default false,
  add column if not exists repeat_reason text;

-- Owner-only chronological ordering within each year.

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
