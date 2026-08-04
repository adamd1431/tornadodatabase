create extension if not exists pgcrypto;

create table if not exists public.user_top100_lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  owner_name text not null default 'User',
  title text not null default 'My Top 100',
  description text not null default '',
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_top100_lists enable row level security;

drop policy if exists "user_top100_lists_select_public_or_owner" on public.user_top100_lists;
create policy "user_top100_lists_select_public_or_owner"
  on public.user_top100_lists
  for select
  using (visibility = 'public' or auth.uid() = owner_id);

drop policy if exists "user_top100_lists_insert_own" on public.user_top100_lists;
create policy "user_top100_lists_insert_own"
  on public.user_top100_lists
  for insert
  with check (auth.uid() = owner_id);

drop policy if exists "user_top100_lists_update_own" on public.user_top100_lists;
create policy "user_top100_lists_update_own"
  on public.user_top100_lists
  for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "user_top100_lists_delete_own" on public.user_top100_lists;
create policy "user_top100_lists_delete_own"
  on public.user_top100_lists
  for delete
  using (auth.uid() = owner_id);

create index if not exists user_top100_lists_owner_id_idx
  on public.user_top100_lists(owner_id);

create index if not exists user_top100_lists_visibility_updated_idx
  on public.user_top100_lists(visibility, updated_at desc);
