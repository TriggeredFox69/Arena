-- ==========================================================================
-- 004_chess_online_fixes.sql
-- Unblocks online Quick-Match for Chess. Run in the Supabase SQL Editor.
--
-- Fixes three bugs that prevented serverless online play from working:
--   1. Matchmaking tables FK'd to auth.users — but ArenaX users live in
--      public.users (custom JWT auth, see 001_initial.sql:7). Queue inserts
--      failed FK validation, so Quick-Match never got past the first click.
--   2. room_events had no RLS / no anon SELECT policy — Supabase Realtime
--      postgres_changes subscriptions made with the anon key (which is what
--      js/socket-client.js uses) silently received nothing, so move events
--      never reached the opponent's browser.
--   3. room_events.type CHECK excluded 'rematch' — rooms-supabase.js inserts
--      type='rematch', which would violate the constraint.
-- ==========================================================================

-- -------------------------------------------------------------------------
-- Fix 1: re-point matchmaking FKs from auth.users → public.users.
-- Postgres auto-names these constraints "<table>_<col>_fkey".
-- Drop and recreate so the new reference takes regardless of old state.
-- -------------------------------------------------------------------------
ALTER TABLE public.matchmaking_queue
  DROP CONSTRAINT IF EXISTS matchmaking_queue_user_id_fkey;
ALTER TABLE public.matchmaking_queue
  ADD CONSTRAINT matchmaking_queue_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.matchmaking_matches
  DROP CONSTRAINT IF EXISTS matchmaking_matches_user_id_fkey;
ALTER TABLE public.matchmaking_matches
  ADD CONSTRAINT matchmaking_matches_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.matchmaking_matches
  DROP CONSTRAINT IF EXISTS matchmaking_matches_opponent_id_fkey;
ALTER TABLE public.matchmaking_matches
  ADD CONSTRAINT matchmaking_matches_opponent_id_fkey
  FOREIGN KEY (opponent_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- The matchmaking RLS policies in supabase_matchmaking_migration.sql use
-- auth.uid() = user_id, which is always NULL for ArenaX (custom JWT, no
-- Supabase Auth session). The backend uses supabaseAdmin (service role),
-- which bypasses RLS entirely, so those policies are inert — leave RLS
-- enabled (harmless) but the service role is what matters. No change needed
-- here; documented for clarity.

-- -------------------------------------------------------------------------
-- Fix 2: enable RLS + anon read policy on room_events so the anon-key
-- Realtime subscription in socket-client.js actually receives INSERT events.
-- Writes stay service-role-only (no INSERT/UPDATE policy for anon).
-- -------------------------------------------------------------------------
ALTER TABLE public.room_events ENABLE ROW LEVEL SECURITY;

-- Public read is safe: payloads are game moves (no secrets). Writes are
-- service-role only, so anons cannot forge events.
DROP POLICY IF EXISTS "anon can read room events" ON public.room_events;
CREATE POLICY "anon can read room events"
  ON public.room_events FOR SELECT
  USING (true);

-- -------------------------------------------------------------------------
-- Fix 3: allow 'rematch' as a room_events type.
-- The original CHECK (003:24) excluded it; rooms-supabase.js inserts it.
-- Drop and recreate the constraint with the full allowed set.
-- -------------------------------------------------------------------------
ALTER TABLE public.room_events
  DROP CONSTRAINT IF EXISTS room_events_type_check;
ALTER TABLE public.room_events
  ADD CONSTRAINT room_events_type_check
  CHECK (type IN ('start','action','end','leave','forfeit','sync','rematch'));

-- -------------------------------------------------------------------------
-- Re-publish room_events to realtime (idempotent) in case the table was
-- created fresh after 003 ran.
-- -------------------------------------------------------------------------
ALTER TABLE public.room_events REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$$;
ALTER PUBLICATION supabase_realtime DROP TABLE public.room_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_events;
