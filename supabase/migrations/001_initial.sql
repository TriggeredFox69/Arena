-- ArenaX schema for Supabase Postgres
-- Run this in the Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (kept separate from auth.users so existing JWT logic continues to work)
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 100,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  total_wagered INTEGER NOT NULL DEFAULT 0,
  total_won INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Transactions (deposits, withdrawals, wagers, settlements)
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  game TEXT,
  description TEXT,
  wager INTEGER DEFAULT 0,
  pot INTEGER DEFAULT 0,
  result TEXT,
  pkr_amount INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Matches / game history
CREATE TABLE IF NOT EXISTS public.matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  game_key TEXT NOT NULL,
  mode TEXT NOT NULL,
  wager INTEGER NOT NULL,
  pot INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  result TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);

-- Friends system
CREATE TABLE IF NOT EXISTS public.friends (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, friend_id)
);

-- Marketplace orders
CREATE TABLE IF NOT EXISTS public.marketplace_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  amount_ax INTEGER NOT NULL,
  price_per_ax REAL NOT NULL,
  filled_amount INTEGER NOT NULL DEFAULT 0,
  total_value REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  filled_at TIMESTAMPTZ
);

-- Marketplace trades
CREATE TABLE IF NOT EXISTS public.trades (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  buy_order_id UUID NOT NULL REFERENCES public.marketplace_orders(id),
  sell_order_id UUID NOT NULL REFERENCES public.marketplace_orders(id),
  buyer_id UUID NOT NULL REFERENCES public.users(id),
  seller_id UUID NOT NULL REFERENCES public.users(id),
  amount_ax INTEGER NOT NULL,
  price_per_ax REAL NOT NULL,
  total_value REAL NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Token transfers between users
CREATE TABLE IF NOT EXISTS public.transfers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_user_id UUID NOT NULL REFERENCES public.users(id),
  to_user_id UUID NOT NULL REFERENCES public.users(id),
  amount_ax INTEGER NOT NULL,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Chat messages (room based)
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES public.users(id),
  message TEXT NOT NULL,
  emoji_reaction TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Game rooms / invites
CREATE TABLE IF NOT EXISTS public.game_rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_code TEXT UNIQUE NOT NULL,
  creator_id UUID NOT NULL REFERENCES public.users(id),
  game_key TEXT NOT NULL,
  wager INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'waiting',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- USDT transactions (mock table for future gateway)
CREATE TABLE IF NOT EXISTS public.usdt_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id),
  type TEXT NOT NULL,
  usdt_amount REAL NOT NULL,
  ax_amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  usdt_address TEXT,
  txn_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_transactions_user ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_matches_user ON public.matches(user_id);
CREATE INDEX IF NOT EXISTS idx_friends_user ON public.friends(user_id);
CREATE INDEX IF NOT EXISTS idx_friends_friend ON public.friends(friend_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_user ON public.marketplace_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_status ON public.marketplace_orders(status);
CREATE INDEX IF NOT EXISTS idx_trades_buyer ON public.trades(buyer_id);
CREATE INDEX IF NOT EXISTS idx_trades_seller ON public.trades(seller_id);
CREATE INDEX IF NOT EXISTS idx_transfers_from ON public.transfers(from_user_id);
CREATE INDEX IF NOT EXISTS idx_transfers_to ON public.transfers(to_user_id);
CREATE INDEX IF NOT EXISTS idx_chat_game ON public.chat_messages(game_id);
CREATE INDEX IF NOT EXISTS idx_rooms_code ON public.game_rooms(room_code);
CREATE INDEX IF NOT EXISTS idx_usdt_user ON public.usdt_transactions(user_id);

-- Row Level Security (RLS) basics
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usdt_transactions ENABLE ROW LEVEL SECURITY;

-- Service-role access policy (Netlify Functions use service key)
DROP POLICY IF EXISTS service_all ON public.users;
CREATE POLICY service_all ON public.users FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_all ON public.transactions;
CREATE POLICY service_all ON public.transactions FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_all ON public.matches;
CREATE POLICY service_all ON public.matches FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_all ON public.friends;
CREATE POLICY service_all ON public.friends FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_all ON public.marketplace_orders;
CREATE POLICY service_all ON public.marketplace_orders FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_all ON public.trades;
CREATE POLICY service_all ON public.trades FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_all ON public.transfers;
CREATE POLICY service_all ON public.transfers FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_all ON public.chat_messages;
CREATE POLICY service_all ON public.chat_messages FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_all ON public.game_rooms;
CREATE POLICY service_all ON public.game_rooms FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_all ON public.usdt_transactions;
CREATE POLICY service_all ON public.usdt_transactions FOR ALL USING (true) WITH CHECK (true);
