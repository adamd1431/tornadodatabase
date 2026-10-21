-- Run once in Supabase SQL Editor after supabase-user-upload-workflow.sql.
-- Safe to rerun. Changes permissions only; does not delete existing records.
-- Missing tables can be created later with their normal setup SQL.
begin;

do $$
begin
  if to_regclass('public.outbreaks') is not null then
    drop policy if exists "admins delete outbreaks" on public.outbreaks;
    drop policy if exists "owner deletes outbreaks" on public.outbreaks;
    create policy "owner deletes outbreaks" on public.outbreaks
      for delete to authenticated using (public.utwx_is_owner(auth.uid()));
  end if;

  if to_regclass('public.tropical_cyclones') is not null then
    drop policy if exists cyclone_admin_delete on public.tropical_cyclones;
    drop policy if exists cyclone_owner_delete on public.tropical_cyclones;
    create policy cyclone_owner_delete on public.tropical_cyclones
      for delete to authenticated using (public.utwx_is_owner(auth.uid()));
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
