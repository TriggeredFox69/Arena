-- 003_room_players_and_events.sql
-- Adds player_two, ready flags, status tracking, and an authoritative room-events
-- table used by Supabase Realtime to relay 1v1 game actions.

-- Additional room state columns
ALTER TABLE public.game_rooms
  ADD COLUMN IF NOT EXISTS player_two_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS creator_ready BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS player_two_ready BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS player_one_status TEXT NOT NULL DEFAULT 'online',
  ADD COLUMN IF NOT EXISTS player_two_status TEXT NOT NULL DEFAULT 'offline',
  ADD COLUMN IF NOT EXISTS creator_match_id UUID REFERENCES public.matches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS player_two_match_id UUID REFERENCES public.matches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_game_rooms_player_two ON public.game_rooms(player_two_id);
CREATE INDEX IF NOT EXISTS idx_game_rooms_status ON public.game_rooms(status);

-- Authoritative event log for every room. Netlify Functions insert rows;
-- clients subscribe to realtime inserts to receive game:start, action, end, etc.
CREATE TABLE IF NOT EXISTS public.room_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL REFERENCES public.game_rooms(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('start','action','end','leave','forfeit','sync')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_room_events_room_created ON public.room_events(room_id, created_at DESC);

-- Enable realtime for the tables the client listens to.
-- (Supabase already creates the supabase_realtime publication by default.)
ALTER TABLE public.game_rooms REPLICA IDENTITY FULL;
ALTER TABLE public.room_events REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$$;

ALTER PUBLICATION supabase_realtime ADD TABLE public.game_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_events;

-- Helper to atomically mark a player ready and return the full room row.
-- Returns the room only if both players are now ready (the trigger to start).
CREATE OR REPLACE FUNCTION public.mark_room_ready(p_room_id UUID, p_user_id UUID)
RETURNS public.game_rooms
LANGUAGE plpgsql
AS $$
DECLARE
  room public.game_rooms;
BEGIN
  SELECT * INTO room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;

  IF room IS NULL THEN
    RAISE EXCEPTION 'Room not found';
  END IF;

  IF room.status NOT IN ('waiting', 'ready') THEN
    RAISE EXCEPTION 'Room is not open for ready marks';
  END IF;

  IF room.creator_id = p_user_id THEN
    UPDATE public.game_rooms SET creator_ready = true WHERE id = p_room_id;
  ELSIF room.player_two_id = p_user_id THEN
    UPDATE public.game_rooms SET player_two_ready = true WHERE id = p_room_id;
  ELSE
    RAISE EXCEPTION 'User is not in this room';
  END IF;

  SELECT * INTO room FROM public.game_rooms WHERE id = p_room_id;
  RETURN room;
END;
$$;

-- Helper to atomically validate turn ownership and switch the turn column.
-- Respects payload.keepTurn so multi-step moves (e.g. checkers multi-jump) stay
-- on the same player.
CREATE OR REPLACE FUNCTION public.record_room_action(
  p_room_id UUID,
  p_user_id UUID,
  p_payload JSONB
)
RETURNS public.game_rooms
LANGUAGE plpgsql
AS $$
DECLARE
  room public.game_rooms;
  next_turn UUID;
  keep_turn BOOLEAN;
BEGIN
  SELECT * INTO room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;

  IF room IS NULL THEN
    RAISE EXCEPTION 'Room not found';
  END IF;

  IF room.status != 'in_progress' THEN
    RAISE EXCEPTION 'Game is not in progress';
  END IF;

  IF room.current_turn_user_id IS NOT NULL AND room.current_turn_user_id != p_user_id THEN
    RAISE EXCEPTION 'Not your turn';
  END IF;

  keep_turn := COALESCE((p_payload->>'keepTurn')::boolean, (p_payload->'action'->>'keepTurn')::boolean, false);

  IF NOT keep_turn THEN
    -- Toggle turn to the other player
    IF room.creator_id = p_user_id THEN
      next_turn := room.player_two_id;
    ELSIF room.player_two_id = p_user_id THEN
      next_turn := room.creator_id;
    ELSE
      RAISE EXCEPTION 'User is not in this room';
    END IF;

    UPDATE public.game_rooms
      SET current_turn_user_id = next_turn
      WHERE id = p_room_id;
  ELSE
    next_turn := p_user_id;
  END IF;

  INSERT INTO public.room_events (room_id, user_id, type, payload)
    VALUES (p_room_id, p_user_id, 'action', p_payload || jsonb_build_object('nextTurn', next_turn));

  SELECT * INTO room FROM public.game_rooms WHERE id = p_room_id;
  RETURN room;
END;
$$;

-- Atomic balance increment (avoids read-modify-write races on user balances).
CREATE OR REPLACE FUNCTION public.increment_balance(p_user_id UUID, p_amount INTEGER)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.users
    SET balance = balance + p_amount,
        total_won = CASE WHEN p_amount > 0 THEN total_won + p_amount ELSE total_won END
    WHERE id = p_user_id;
END;
$$;

-- Record a match result: credit winner, increment stats for both players.
CREATE OR REPLACE FUNCTION public.record_match_result(
  p_winner_id UUID,
  p_loser_id UUID,
  p_amount INTEGER
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_winner_id IS NOT NULL THEN
    UPDATE public.users
      SET balance = balance + COALESCE(p_amount, 0),
          total_won = total_won + COALESCE(p_amount, 0),
          wins = wins + 1
      WHERE id = p_winner_id;
  END IF;

  IF p_loser_id IS NOT NULL THEN
    UPDATE public.users
      SET losses = losses + 1
      WHERE id = p_loser_id;
  END IF;
END;
$$;
