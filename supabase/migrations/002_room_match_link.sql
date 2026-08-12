-- 002_room_match_link.sql
-- Links game rooms to matches and tracks turn state server-side.
-- Run in the Supabase SQL Editor after 001_initial.sql.

ALTER TABLE public.game_rooms
  ADD COLUMN IF NOT EXISTS match_id UUID REFERENCES public.matches(id),
  ADD COLUMN IF NOT EXISTS current_turn_user_id UUID REFERENCES public.users(id);

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS room_id UUID REFERENCES public.game_rooms(id);

CREATE INDEX IF NOT EXISTS idx_matches_room ON public.matches(room_id);
