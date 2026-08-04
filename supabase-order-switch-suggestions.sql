-- Run this in Supabase SQL Editor to enable same-day tornado ordering
-- and public order-switch suggestions.

create extension if not exists pgcrypto;

alter table public.tornadoes
  add column if not exists day_order integer not null default 0;

create table if not exists public.order_switch_suggestions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  tornado_a_id uuid not null references public.tornadoes(id) on delete cascade,
  tornado_b_id uuid not null references public.tornadoes(id) on delete cascade,
  event_date date,
  suggested_by uuid references auth.users(id) on delete set null,
  suggested_by_name text not null default 'Guest',
  before_order jsonb not null default '[]'::jsonb,
  after_order jsonb not null default '[]'::jsonb
);

create index if not exists tornadoes_date_day_order_idx
  on public.tornadoes(date, day_order, name);

create index if not exists order_switch_suggestions_status_created_idx
  on public.order_switch_suggestions(status, created_at desc);

create index if not exists order_switch_suggestions_tornado_a_idx
  on public.order_switch_suggestions(tornado_a_id);

create index if not exists order_switch_suggestions_tornado_b_idx
  on public.order_switch_suggestions(tornado_b_id);

alter table public.order_switch_suggestions enable row level security;

grant select, insert on public.order_switch_suggestions to anon, authenticated;
grant update, delete on public.order_switch_suggestions to authenticated;

drop policy if exists "anyone creates order switch suggestions" on public.order_switch_suggestions;
create policy "anyone creates order switch suggestions"
on public.order_switch_suggestions
for insert
to anon, authenticated
with check (
  status = 'pending'
  and (suggested_by is null or suggested_by = auth.uid())
);

drop policy if exists "admins read order switch suggestions" on public.order_switch_suggestions;
create policy "admins read order switch suggestions"
on public.order_switch_suggestions
for select
to authenticated
using (public.utwx_is_admin(auth.uid()));

drop policy if exists "admins update order switch suggestions" on public.order_switch_suggestions;
create policy "admins update order switch suggestions"
on public.order_switch_suggestions
for update
to authenticated
using (public.utwx_is_admin(auth.uid()))
with check (public.utwx_is_admin(auth.uid()));

drop policy if exists "admins delete order switch suggestions" on public.order_switch_suggestions;
create policy "admins delete order switch suggestions"
on public.order_switch_suggestions
for delete
to authenticated
using (public.utwx_is_admin(auth.uid()));
