-- ==========================================================================
-- ARENAX - Matchmaking tables & RPCs (run in Supabase SQL Editor)
-- ==========================================================================

-- Queue table: one row per user per game_key
create table if not exists public.matchmaking_queue (
  id bigserial primary key,
  game_key text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null,
  wager int not null default 0,
  created_at timestamptz not null default now(),
  unique (game_key, user_id)
);

-- Index for fast "find opponent" queries
create index if not exists idx_matchmaking_queue_game_wager
  on public.matchmaking_queue (game_key, wager, created_at);

-- Match results table: created by claim RPC, consumed by /status
create table if not exists public.matchmaking_matches (
  id bigserial primary key,
  game_key text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('host','guest')),
  room_code text not null,
  room_id uuid not null,
  opponent_id uuid not null references auth.users(id) on delete cascade,
  opponent_username text not null,
  opponent_wager int not null,
  wager int not null,
  message text,
  created_at timestamptz not null default now(),
  unique (game_key, user_id)
);

-- RPC: atomically claim an opponent or return none
-- Returns SETOF record with opponent details if matched, empty set if not
create or replace function public.matchmaking_claim_opponent(
  p_game_key text,
  p_user_id uuid,
  p_username text,
  p_wager int
)
returns setof record
language plpgsql
security definer
as $$
declare
  opp record;
  room_code text;
  room_id uuid;
  match_wager int;
begin
  -- Try same wager first
  select * into opp
  from public.matchmaking_queue
  where game_key = p_game_key
    and user_id <> p_user_id
    and wager = p_wager
  order by created_at asc
  limit 1
  for update skip locked;

  -- Then any wager
  if not found then
    select * into opp
    from public.matchmaking_queue
    where game_key = p_game_key
      and user_id <> p_user_id
    order by created_at asc
    limit 1
    for update skip locked;
  end if;

  if not found then
    return query select null::uuid as opponent_id, null::text as opponent_username,
      null::text as room_code, null::uuid as room_id, null::text as role,
      null::int as opponent_wager;
    return;
  end if;

  -- Generate room code
  room_code := public.gen_room_code();

  -- Create the room (insert into game_rooms)
  match_wager := greatest(p_wager, opp.wager);
  insert into public.game_rooms (room_code, creator_id, player_two_id, game_key, wager, status)
  values (room_code, opp.user_id, p_user_id, p_game_key, match_wager, 'ready')
  returning id into room_id;

  -- Remove opponent from queue
  delete from public.matchmaking_queue where id = opp.id;

  -- Store match for opponent (they'll pick it up on /status)
  insert into public.matchmaking_matches (game_key, user_id, role, room_code, room_id,
    opponent_id, opponent_username, opponent_wager, wager, message)
  values (p_game_key, opp.user_id, 'host', room_code, room_id,
    p_user_id, p_username, p_wager, match_wager,
    'Matched with ' || p_username || '!')
  on conflict (game_key, user_id) do update set
    role = 'host', room_code = room_code, room_id = room_id,
    opponent_id = p_user_id, opponent_username = p_username,
    opponent_wager = p_wager, wager = match_wager,
    message = 'Matched with ' || p_username || '!', created_at = now();

  -- Return match info for current player
  return query select
    opp.user_id as opponent_id,
    opp.username as opponent_username,
    room_code,
    room_id,
    'guest'::text as role,
    opp.wager as opponent_wager;
end;
$$;

-- RPC: get queue position for a user
create or replace function public.matchmaking_queue_position(
  p_user_id uuid,
  p_game_key text
)
returns int
language sql
security definer
as $$
  select count(*) + 1
  from public.matchmaking_queue
  where game_key = p_game_key
    and created_at < (
      select created_at from public.matchmaking_queue
      where user_id = p_user_id and game_key = p_game_key
    );
$$;

-- Helper: generate room code (reusable)
create or replace function public.gen_room_code()
returns text
language plpgsql
as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text := '';
  i int;
  exists_flag boolean;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(chars, floor(random() * length(chars))::int + 1, 1);
    end loop;
    select exists(select 1 from public.game_rooms where room_code = code) into exists_flag;
    if not exists_flag then return code; end if;
  end loop;
end;
$$;

-- RLS policies
alter table public.matchmaking_queue enable row level security;
alter table public.matchmaking_matches enable row level security;

create policy "Users can read own queue entries"
  on public.matchmaking_queue for select
  using (auth.uid() = user_id);

create policy "Users can insert own queue entries"
  on public.matchmaking_queue for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own queue entries"
  on public.matchmaking_queue for delete
  using (auth.uid() = user_id);

create policy "Users can read own matches"
  on public.matchmaking_matches for select
  using (auth.uid() = user_id);

create policy "System can insert matches"
  on public.matchmaking_matches for insert
  with check (true);

create policy "Users can delete own matches"
  on public.matchmaking_matches for delete
  using (auth.uid() = user_id);