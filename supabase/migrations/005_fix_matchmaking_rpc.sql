-- ==========================================================================
-- 005_fix_matchmaking_rpc.sql
-- Fixes: Postgres 0A000 "materialize mode required, but it is not allowed in
-- this context" when calling matchmaking_claim_opponent via Supabase rpc().
--
-- Cause: the original function (supabase_matchmaking_migration.sql) was
-- declared `RETURNS SETOF record` and used `RETURN QUERY`. A SETOF record
-- function has no statically-known column list, so PostgREST cannot call it —
-- it needs a materialized result shape.
--
-- Fix: declare an explicit RETURNS TABLE(...) so the row shape is known, and
-- return a single row (matched or all-NULLs) instead of a record set.
-- Run this in the Supabase SQL Editor after 004.
-- ==========================================================================

DROP FUNCTION IF EXISTS public.matchmaking_claim_opponent(text, uuid, text, int);

CREATE OR REPLACE FUNCTION public.matchmaking_claim_opponent(
  p_game_key text,
  p_user_id uuid,
  p_username text,
  p_wager int
)
RETURNS TABLE (
  opponent_id uuid,
  opponent_username text,
  room_code text,
  room_id uuid,
  role text,
  opponent_wager int
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  opp           public.matchmaking_queue;
  v_room_code   text;
  v_room_id     uuid;
  v_match_wager int;
BEGIN
  -- Prefer an opponent queued at the same wager, then any opponent.
  SELECT * INTO opp
  FROM public.matchmaking_queue
  WHERE game_key = p_game_key
    AND user_id <> p_user_id
    AND wager = p_wager
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    SELECT * INTO opp
    FROM public.matchmaking_queue
    WHERE game_key = p_game_key
      AND user_id <> p_user_id
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
  END IF;

  -- No one waiting: return a single all-NULL row. The API layer checks
  -- opponent_id IS NULL to decide "not matched" (matchmaking.js:43).
  IF NOT FOUND THEN
    RETURN QUERY SELECT
      NULL::uuid, NULL::text, NULL::text, NULL::uuid, NULL::text, NULL::int;
    RETURN;
  END IF;

  v_match_wager := GREATEST(p_wager, opp.wager);
  v_room_code   := public.gen_room_code();

  -- The waiting player becomes host (White in chess); the claimer is guest.
  INSERT INTO public.game_rooms (room_code, creator_id, player_two_id, game_key, wager, status)
  VALUES (v_room_code, opp.user_id, p_user_id, p_game_key, v_match_wager, 'ready')
  RETURNING id INTO v_room_id;

  DELETE FROM public.matchmaking_queue WHERE id = opp.id;
  -- Also drop the claimer's own queue row if they had one for this game.
  DELETE FROM public.matchmaking_queue
   WHERE game_key = p_game_key AND user_id = p_user_id;

  -- Leave a match record the host picks up on their next /status poll.
  INSERT INTO public.matchmaking_matches (
    game_key, user_id, role, room_code, room_id,
    opponent_id, opponent_username, opponent_wager, wager, message
  )
  VALUES (
    p_game_key, opp.user_id, 'host', v_room_code, v_room_id,
    p_user_id, p_username, p_wager, v_match_wager,
    'Matched with ' || p_username || '!'
  )
  ON CONFLICT (game_key, user_id) DO UPDATE SET
    role              = 'host',
    room_code         = EXCLUDED.room_code,
    room_id           = EXCLUDED.room_id,
    opponent_id       = EXCLUDED.opponent_id,
    opponent_username = EXCLUDED.opponent_username,
    opponent_wager    = EXCLUDED.opponent_wager,
    wager             = EXCLUDED.wager,
    message           = EXCLUDED.message,
    created_at        = NOW();

  RETURN QUERY SELECT
    opp.user_id,
    opp.username,
    v_room_code,
    v_room_id,
    'guest'::text,
    opp.wager;
END;
$$;

-- matchmaking_queue_position returns a scalar int, which rpc() handles fine.
-- Recreated here only to guarantee it exists.
CREATE OR REPLACE FUNCTION public.matchmaking_queue_position(
  p_user_id uuid,
  p_game_key text
)
RETURNS int
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT COUNT(*)::int + 1
  FROM public.matchmaking_queue
  WHERE game_key = p_game_key
    AND created_at < (
      SELECT created_at FROM public.matchmaking_queue
      WHERE user_id = p_user_id AND game_key = p_game_key
    );
$$;
