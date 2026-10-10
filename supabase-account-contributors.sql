-- Run this once in the Supabase SQL editor.
-- It lets uploads and tornado submissions stay tied to the signed-in account
-- even after the user changes their username.

alter table public.uploads
  add column if not exists user_id uuid references auth.users(id) on delete set null;

alter table public.tornadoes
  add column if not exists user_id uuid references auth.users(id) on delete set null;

alter table public.summary_submissions
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists uploads_user_id_idx
  on public.uploads(user_id);

create index if not exists tornadoes_user_id_idx
  on public.tornadoes(user_id);

create index if not exists summary_submissions_user_id_idx
  on public.summary_submissions(user_id);

-- Best-effort backfill for rows whose contributor name still matches a profile.
update public.uploads u
set user_id = p.id
from public.profiles p
where u.user_id is null
  and u.uploaded_by is not null
  and lower(btrim(u.uploaded_by)) = lower(btrim(p.username));

update public.tornadoes t
set user_id = p.id
from public.profiles p
where t.user_id is null
  and t.submitted_by is not null
  and lower(btrim(t.submitted_by)) = lower(btrim(p.username));

update public.summary_submissions s
set user_id = p.id
from public.profiles p
where s.user_id is null
  and s.submitted_by is not null
  and lower(btrim(s.submitted_by)) = lower(btrim(p.username));

-- If older leaderboard rows used an old username, add manual aliases here and run
-- the matching updates. Replace the UUID and alias examples before uncommenting.
--
-- with aliases(user_id, alias) as (
--   values
--     ('00000000-0000-0000-0000-000000000000'::uuid, 'old_username')
-- )
-- update public.uploads u
-- set user_id = a.user_id
-- from aliases a
-- where u.user_id is null
--   and lower(btrim(u.uploaded_by)) = lower(btrim(a.alias));
--
-- with aliases(user_id, alias) as (
--   values
--     ('00000000-0000-0000-0000-000000000000'::uuid, 'old_username')
-- )
-- update public.tornadoes t
-- set user_id = a.user_id
-- from aliases a
-- where t.user_id is null
--   and lower(btrim(t.submitted_by)) = lower(btrim(a.alias));
