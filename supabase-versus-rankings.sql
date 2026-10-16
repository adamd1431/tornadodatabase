-- Run this file once in the Supabase SQL editor before using shared Versus rankings.
-- Solo runs are separate entries, so one account can hold multiple Top 25 spots.
-- Ranked 1v1 results require matching reports from BOTH signed-in opponents.
-- Elo starts at 1200, uses K=32, and is updated atomically exactly once per match.
-- This extends the existing client-hosted game; it is not server-authoritative anti-cheat.

begin;

create table if not exists public.versus_player_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  rating integer not null default 1200 check (rating >= 0),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  draws integer not null default 0 check (draws >= 0),
  last_played_at timestamptz
);

create table if not exists public.versus_solo_runs (
  match_key text primary key check (length(match_key) between 1 and 160),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 24),
  score integer not null check (score between 0 and 5000),
  correct integer not null check (correct between 0 and 5),
  elapsed_ms integer not null check (elapsed_ms between 0 and 60000),
  created_at timestamptz not null default now()
);
create index if not exists versus_solo_ranking_idx
  on public.versus_solo_runs(score desc, correct desc, elapsed_ms, created_at, match_key);

create table if not exists public.versus_ranked_matches (
  match_key text primary key check (length(match_key) between 1 and 160),
  player_a uuid not null references auth.users(id) on delete cascade,
  player_b uuid not null references auth.users(id) on delete cascade,
  name_a text,
  name_b text,
  report_a jsonb,
  report_b jsonb,
  score_a integer,
  score_b integer,
  rating_a_before integer,
  rating_b_before integer,
  rating_a_after integer,
  rating_b_after integer,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (player_a < player_b)
);

alter table public.versus_player_stats enable row level security;
alter table public.versus_solo_runs enable row level security;
alter table public.versus_ranked_matches enable row level security;
revoke all on public.versus_player_stats, public.versus_solo_runs, public.versus_ranked_matches from public, anon, authenticated;

-- Scores use the game's fixed five rounds and 12-second, 500--1000-point formula.
-- Check approved tornado IDs and answer IDs instead of accepting supplied points.
create or replace function public._versus_score_rounds(p_rounds jsonb, p_choice_key text, p_elapsed_key text)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare
  r jsonb;
  elapsed integer;
  points integer := 0;
  correct_count integer := 0;
  total_elapsed integer := 0;
begin
  if jsonb_typeof(p_rounds) is distinct from 'array' then raise exception 'Five rounds are required'; end if;
  if jsonb_array_length(p_rounds) <> 5 then raise exception 'Five rounds are required'; end if;
  if (select count(distinct value->>'tornado_id') from jsonb_array_elements(p_rounds)) <> 5 then
    raise exception 'Five different tornadoes are required';
  end if;
  for r in select value from jsonb_array_elements(p_rounds) loop
    if not exists (select 1 from public.tornadoes t where t.id::text = r->>'tornado_id' and t.status = 'approved') then
      raise exception 'Round tornado is not approved';
    end if;
    if jsonb_typeof(r->p_elapsed_key) is distinct from 'number' or
       (r->>p_elapsed_key)::numeric not between 0 and 12000 or
       (r->>p_elapsed_key)::numeric <> trunc((r->>p_elapsed_key)::numeric) then
      raise exception 'Invalid answer time';
    end if;
    elapsed := (r->>p_elapsed_key)::integer;
    total_elapsed := total_elapsed + elapsed;
    if r->>p_choice_key = r->>'tornado_id' then
      correct_count := correct_count + 1;
      points := points + round(500 + (1 - elapsed / 12000.0) * 500)::integer;
    end if;
  end loop;
  return jsonb_build_object('score', points, 'correct', correct_count, 'elapsed_ms', total_elapsed);
end;
$$;
revoke all on function public._versus_score_rounds(jsonb,text,text) from public, anon, authenticated;

create or replace function public.versus_profile(p_user_id uuid default auth.uid())
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'user_id', p.id, 'username', p.username,
    'rating', coalesce(s.rating,1200), 'wins', coalesce(s.wins,0),
    'losses', coalesce(s.losses,0), 'draws', coalesce(s.draws,0),
    'games', coalesce(s.wins+s.losses+s.draws,0)
  ) from public.profiles p left join public.versus_player_stats s on s.user_id = p.id
  where p.id = p_user_id;
$$;

create or replace function public.versus_leaderboard(p_mode text default 'practice')
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_mode = 'practice' then
    return coalesce((select jsonb_agg(to_jsonb(r) order by r.rank) from (
      select row_number() over (order by g.score desc,g.correct desc,g.elapsed_ms,g.created_at,g.match_key) as rank,
        g.match_key,g.user_id,g.display_name,p.username,g.score,g.correct,g.elapsed_ms,g.created_at
      from public.versus_solo_runs g join public.profiles p on p.id = g.user_id
      order by g.score desc,g.correct desc,g.elapsed_ms,g.created_at,g.match_key limit 25
    ) r), '[]'::jsonb);
  elsif p_mode = 'elo' then
    return coalesce((select jsonb_agg(to_jsonb(r) order by r.rank) from (
      select row_number() over (order by s.rating desc,s.wins desc,s.last_played_at,s.user_id) as rank,
        s.user_id,p.username,coalesce(s.display_name,p.username) as display_name,s.rating,s.wins,s.losses,s.draws,
        s.wins+s.losses+s.draws as games
      from public.versus_player_stats s join public.profiles p on p.id = s.user_id
      where s.wins+s.losses+s.draws > 0
      order by s.rating desc,s.wins desc,s.last_played_at,s.user_id limit 25
    ) r), '[]'::jsonb);
  end if;
  raise exception 'Unknown leaderboard';
end;
$$;

create or replace function public.versus_submit_practice(p_match_key text, p_display_name text, p_rounds jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  result jsonb;
  saved public.versus_solo_runs;
begin
  if uid is null then raise exception 'Sign in to save a score'; end if;
  if not exists (select 1 from public.profiles where id = uid and nullif(btrim(username),'') is not null) then
    raise exception 'Set a Tornado Database username first';
  end if;
  result := public._versus_score_rounds(p_rounds,'choice_id','elapsed_ms');
  insert into public.versus_solo_runs(match_key,user_id,display_name,score,correct,elapsed_ms)
    values (p_match_key,uid,left(coalesce(nullif(btrim(p_display_name),''),'Player'),24),
      (result->>'score')::integer,(result->>'correct')::integer,(result->>'elapsed_ms')::integer)
    on conflict (match_key) do nothing;
  select * into saved from public.versus_solo_runs where match_key = p_match_key;
  if saved.user_id <> uid then raise exception 'This run belongs to another player'; end if;
  return jsonb_build_object('status','saved','score',saved.score,'correct',saved.correct);
end;
$$;

create or replace function public.versus_report_match(p_match_key text, p_opponent_id uuid, p_display_name text, p_rounds jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  a uuid;
  b uuid;
  m public.versus_ranked_matches;
  stats_a public.versus_player_stats;
  stats_b public.versus_player_stats;
  points_a integer;
  points_b integer;
  actual_a numeric;
  delta integer;
begin
  if uid is null then raise exception 'Sign in to save a match'; end if;
  if p_opponent_id is null or p_opponent_id = uid then raise exception 'Two different accounts are required'; end if;
  if (select count(*) from public.profiles where id in (uid,p_opponent_id) and nullif(btrim(username),'') is not null) <> 2 then
    raise exception 'Both players must have a Tornado Database username';
  end if;
  a := least(uid,p_opponent_id);
  b := greatest(uid,p_opponent_id);
  points_a := (public._versus_score_rounds(p_rounds,'choice_a','elapsed_a_ms')->>'score')::integer;
  points_b := (public._versus_score_rounds(p_rounds,'choice_b','elapsed_b_ms')->>'score')::integer;
  insert into public.versus_ranked_matches(match_key,player_a,player_b)
    values (p_match_key,a,b) on conflict (match_key) do nothing;
  select * into m from public.versus_ranked_matches where match_key = p_match_key for update;
  if m.player_a <> a or m.player_b <> b then raise exception 'Match players do not match'; end if;
  if m.completed_at is null then
    if uid = a then
      if m.report_a is not null and m.report_a <> p_rounds then raise exception 'A result has already been submitted'; end if;
      update public.versus_ranked_matches set report_a = p_rounds,
        name_a = left(coalesce(nullif(btrim(p_display_name),''),'Player'),24) where match_key = p_match_key;
    else
      if m.report_b is not null and m.report_b <> p_rounds then raise exception 'A result has already been submitted'; end if;
      update public.versus_ranked_matches set report_b = p_rounds,
        name_b = left(coalesce(nullif(btrim(p_display_name),''),'Player'),24) where match_key = p_match_key;
    end if;
    select * into m from public.versus_ranked_matches where match_key = p_match_key;
    if m.report_a is null or m.report_b is null then return jsonb_build_object('status','pending'); end if;
    if m.report_a <> m.report_b then return jsonb_build_object('status','conflict'); end if;

    insert into public.versus_player_stats(user_id) values (a),(b) on conflict do nothing;
    perform 1 from public.versus_player_stats where user_id in (a,b) order by user_id for update;
    select * into stats_a from public.versus_player_stats where user_id = a;
    select * into stats_b from public.versus_player_stats where user_id = b;
    actual_a := case when points_a > points_b then 1 when points_a < points_b then 0 else 0.5 end;
    delta := round(32 * (actual_a - 1 / (1 + power(10::numeric,(stats_b.rating-stats_a.rating)/400.0))))::integer;
    delta := greatest(-stats_a.rating,least(stats_b.rating,delta));
    update public.versus_player_stats set
      display_name = case when user_id = a then m.name_a else m.name_b end,
      rating = rating + case when user_id = a then delta else -delta end,
      wins = wins + case when (user_id = a and points_a > points_b) or (user_id = b and points_b > points_a) then 1 else 0 end,
      losses = losses + case when (user_id = a and points_a < points_b) or (user_id = b and points_b < points_a) then 1 else 0 end,
      draws = draws + case when points_a = points_b then 1 else 0 end,
      last_played_at = now() where user_id in (a,b);
    update public.versus_ranked_matches set score_a = points_a, score_b = points_b,
      rating_a_before = stats_a.rating, rating_b_before = stats_b.rating,
      rating_a_after = stats_a.rating+delta, rating_b_after = stats_b.rating-delta,
      completed_at = now() where match_key = p_match_key;
    select * into m from public.versus_ranked_matches where match_key = p_match_key;
  end if;
  return jsonb_build_object('status','saved',
    'rating_before',case when uid = a then m.rating_a_before else m.rating_b_before end,
    'rating_after',case when uid = a then m.rating_a_after else m.rating_b_after end,
    'outcome',case when m.score_a = m.score_b then 'draw'
      when (uid = a and m.score_a > m.score_b) or (uid = b and m.score_b > m.score_a) then 'win' else 'loss' end);
end;
$$;

revoke all on function public.versus_profile(uuid), public.versus_leaderboard(text),
  public.versus_submit_practice(text,text,jsonb), public.versus_report_match(text,uuid,text,jsonb) from public;
grant execute on function public.versus_profile(uuid), public.versus_leaderboard(text) to anon, authenticated;
grant execute on function public.versus_submit_practice(text,text,jsonb), public.versus_report_match(text,uuid,text,jsonb) to authenticated;

commit;
