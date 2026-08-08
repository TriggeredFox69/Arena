-- ArenaX Supabase setup script
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query)

-- 1. Users table: stores all registered players
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    phone TEXT,
    password_hash TEXT NOT NULL,
    balance BIGINT NOT NULL DEFAULT 100,
    wins BIGINT NOT NULL DEFAULT 0,
    losses BIGINT NOT NULL DEFAULT 0,
    total_won BIGINT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Matches / game history table
CREATE TABLE IF NOT EXISTS public.matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    game_key TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'solo',
    wager BIGINT NOT NULL DEFAULT 0,
    pot BIGINT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'settled',
    result TEXT NOT NULL DEFAULT 'LOSS',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Transactions table: deposits, withdrawals, game debits/credits
CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    game TEXT,
    description TEXT,
    wager BIGINT NOT NULL DEFAULT 0,
    pkr_amount BIGINT NOT NULL DEFAULT 0,
    result TEXT NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. User activity table: login, register, game play, deposits, withdrawals
CREATE TABLE IF NOT EXISTS public.user_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    details JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Speed up common lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON public.users(username);
CREATE INDEX IF NOT EXISTS idx_matches_user_id ON public.matches(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_user_id ON public.user_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_action ON public.user_activity(action);

-- Optional: enable RLS if you want to restrict direct access from anon key.
-- The backend uses the service role key, so it bypasses RLS.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_activity ENABLE ROW LEVEL SECURITY;

-- If RLS is enabled, the service role key still bypasses it.
-- You can add policies later if you want users to read their own rows directly.
