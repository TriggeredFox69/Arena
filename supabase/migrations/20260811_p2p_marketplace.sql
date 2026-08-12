-- ============================================================================
-- ArenaX P2P Marketplace
-- Run in Supabase SQL Editor (Dashboard -> SQL Editor -> New query).
-- Safe to re-run.
--
-- Model: every order is made by a "maker". Another user (the "taker") opens a
-- trade against it. AX is held in escrow by the platform from the moment the
-- seller commits it, and is only released to the buyer when the seller confirms
-- payment -- so neither side can walk away with both the AX and the money.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Profile plumbing: link public.users to Supabase Auth
-- ---------------------------------------------------------------------------

-- AX committed to open orders / in-flight trades. Not spendable.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS escrow_ax BIGINT NOT NULL DEFAULT 0;
-- password_hash is legacy (custom auth); Supabase Auth owns credentials now.
ALTER TABLE public.users ALTER COLUMN password_hash SET DEFAULT 'supabase-auth';

-- Create a profile row whenever someone signs up through Supabase Auth.
-- public.users.id is kept identical to auth.users.id so auth.uid() joins directly.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_name TEXT;
  try_name  TEXT;
  n         INT := 0;
BEGIN
  base_name := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'username', ''),
    split_part(NEW.email, '@', 1),
    'player'
  );
  try_name := base_name;

  -- usernames are UNIQUE; suffix until we find a free one
  WHILE EXISTS (SELECT 1 FROM public.users WHERE username = try_name) LOOP
    n := n + 1;
    try_name := base_name || n::TEXT;
    IF n > 500 THEN
      try_name := base_name || substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 6);
      EXIT;
    END IF;
  END LOOP;

  -- public.users.email is UNIQUE and still holds rows from the old custom-auth
  -- backend, whose ids do not match auth.users. If one of those squats on this
  -- email the insert would fail and signup would break, so park the stale row's
  -- email rather than losing it. Nothing is deleted; the row is recoverable.
  UPDATE public.users
     SET email = 'legacy+' || id::TEXT || '@arenax.local'
   WHERE email = NEW.email
     AND id <> NEW.id;

  INSERT INTO public.users (id, username, email, phone, password_hash, balance)
  VALUES (
    NEW.id,
    try_name,
    NEW.email,
    NEW.raw_user_meta_data->>'phone',
    'supabase-auth',
    100
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- Backfill: the trigger only fires on new signups, so anyone who already has an
-- auth.users row (created before this migration) would log in fine and then have
-- no trading profile. Give them one.
DO $$
DECLARE
  u RECORD;
BEGIN
  FOR u IN
    SELECT a.id, a.email, a.raw_user_meta_data
    FROM auth.users a
    LEFT JOIN public.users p ON p.id = a.id
    WHERE p.id IS NULL
  LOOP
    UPDATE public.users
       SET email = 'legacy+' || id::TEXT || '@arenax.local'
     WHERE email = u.email AND id <> u.id;

    INSERT INTO public.users (id, username, email, phone, password_hash, balance)
    VALUES (
      u.id,
      COALESCE(
        NULLIF(u.raw_user_meta_data->>'username', ''),
        split_part(u.email, '@', 1) || substr(replace(u.id::TEXT, '-', ''), 1, 4)
      ),
      u.email,
      u.raw_user_meta_data->>'phone',
      'supabase-auth',
      100
    )
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;

-- A user may read their own profile row (balance, escrow, username).
DROP POLICY IF EXISTS "users read own profile" ON public.users;
CREATE POLICY "users read own profile" ON public.users
  FOR SELECT TO authenticated
  USING (id = auth.uid());

-- ---------------------------------------------------------------------------
-- 1. Orders -- the public book. Every row here is a real user's standing offer.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.p2p_orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maker_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- denormalised so the book renders without exposing public.users to everyone
  maker_username   TEXT NOT NULL,
  side             TEXT NOT NULL CHECK (side IN ('sell', 'buy')),
  price_pkr        NUMERIC(12,2) NOT NULL CHECK (price_pkr > 0),
  total_ax         BIGINT NOT NULL CHECK (total_ax > 0),
  remaining_ax     BIGINT NOT NULL CHECK (remaining_ax >= 0),
  min_ax           BIGINT NOT NULL DEFAULT 1 CHECK (min_ax > 0),
  max_ax           BIGINT NOT NULL CHECK (max_ax > 0),
  payment_methods  TEXT[] NOT NULL DEFAULT '{}',
  terms            TEXT,
  status           TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'paused', 'closed')),
  -- distinguishes "maker withdrew this order" (escrow already refunded) from
  -- "fully filled" (escrow still backing in-flight trades). Cancelling a trade
  -- must not resurrect a withdrawn order or refund its escrow twice.
  closed_by_maker  BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT p2p_orders_limits CHECK (max_ax >= min_ax),
  CONSTRAINT p2p_orders_remaining CHECK (remaining_ax <= total_ax)
);

CREATE INDEX IF NOT EXISTS idx_p2p_orders_book
  ON public.p2p_orders (side, status, price_pkr);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_maker
  ON public.p2p_orders (maker_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. Trades -- one taker filling part (or all) of one order.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.p2p_trades (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref               TEXT NOT NULL UNIQUE,
  order_id          UUID NOT NULL REFERENCES public.p2p_orders(id) ON DELETE CASCADE,
  maker_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  maker_username    TEXT NOT NULL,
  taker_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  taker_username    TEXT NOT NULL,
  -- resolved roles: whoever pays PKR is the buyer, whoever gives up AX is the seller
  buyer_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_ax         BIGINT NOT NULL CHECK (amount_ax > 0),
  price_pkr         NUMERIC(12,2) NOT NULL CHECK (price_pkr > 0),
  total_pkr         NUMERIC(14,2) NOT NULL CHECK (total_pkr > 0),
  payment_method    TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending_payment'
                      CHECK (status IN ('pending_payment', 'paid', 'completed',
                                        'cancelled', 'disputed')),
  payment_proof_url TEXT,
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '30 minutes',
  paid_at           TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_p2p_trades_maker ON public.p2p_trades (maker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_p2p_trades_taker ON public.p2p_trades (taker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_p2p_trades_order ON public.p2p_trades (order_id);

-- ---------------------------------------------------------------------------
-- 3. Per-trade chat (+ system events, + screenshot attachments)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.p2p_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id        UUID NOT NULL REFERENCES public.p2p_trades(id) ON DELETE CASCADE,
  sender_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_username TEXT NOT NULL DEFAULT 'System',
  kind            TEXT NOT NULL DEFAULT 'user' CHECK (kind IN ('user', 'system')),
  body            TEXT,
  attachment_url  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT p2p_messages_not_empty
    CHECK (COALESCE(body, '') <> '' OR COALESCE(attachment_url, '') <> '')
);

CREATE INDEX IF NOT EXISTS idx_p2p_messages_trade
  ON public.p2p_messages (trade_id, created_at);

-- ---------------------------------------------------------------------------
-- 4. Scam reports / disputes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.p2p_disputes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id          UUID NOT NULL REFERENCES public.p2p_trades(id) ON DELETE CASCADE,
  reporter_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reporter_username TEXT NOT NULL,
  accused_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason            TEXT NOT NULL,
  details           TEXT,
  evidence_url      TEXT,
  status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'reviewing', 'resolved', 'rejected')),
  resolution        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_p2p_disputes_trade ON public.p2p_disputes (trade_id);

-- ---------------------------------------------------------------------------
-- 5. Row Level Security
--
-- Writes go exclusively through the SECURITY DEFINER functions below, so there
-- are deliberately NO insert/update policies on orders, trades or disputes --
-- a client holding the anon key cannot mint AX, edit a price, or flip a status.
-- ---------------------------------------------------------------------------
ALTER TABLE public.p2p_orders   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p2p_trades   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p2p_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p2p_disputes ENABLE ROW LEVEL SECURITY;

-- The book is public to signed-in users; closed orders stay visible to the maker.
DROP POLICY IF EXISTS "read open book" ON public.p2p_orders;
CREATE POLICY "read open book" ON public.p2p_orders
  FOR SELECT TO authenticated
  USING (status = 'active' OR maker_id = auth.uid());

-- A trade is visible only to its two counterparties.
DROP POLICY IF EXISTS "read own trades" ON public.p2p_trades;
CREATE POLICY "read own trades" ON public.p2p_trades
  FOR SELECT TO authenticated
  USING (maker_id = auth.uid() OR taker_id = auth.uid());

CREATE OR REPLACE FUNCTION public.p2p_is_participant(p_trade_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.p2p_trades t
    WHERE t.id = p_trade_id
      AND (t.maker_id = auth.uid() OR t.taker_id = auth.uid())
  );
$$;

-- Chat: readable and writable by the two counterparties only.
DROP POLICY IF EXISTS "read trade chat" ON public.p2p_messages;
CREATE POLICY "read trade chat" ON public.p2p_messages
  FOR SELECT TO authenticated
  USING (public.p2p_is_participant(trade_id));

DROP POLICY IF EXISTS "write trade chat" ON public.p2p_messages;
CREATE POLICY "write trade chat" ON public.p2p_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    kind = 'user'
    AND sender_id = auth.uid()
    AND public.p2p_is_participant(trade_id)
  );

DROP POLICY IF EXISTS "read own disputes" ON public.p2p_disputes;
CREATE POLICY "read own disputes" ON public.p2p_disputes
  FOR SELECT TO authenticated
  USING (reporter_id = auth.uid() OR accused_id = auth.uid());

-- Realtime for the book and for in-trade chat
ALTER PUBLICATION supabase_realtime ADD TABLE public.p2p_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.p2p_trades;
ALTER PUBLICATION supabase_realtime ADD TABLE public.p2p_messages;

-- ---------------------------------------------------------------------------
-- 6. Internal helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p2p_username(p_uid UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(username, 'Player') FROM public.users WHERE id = p_uid;
$$;

CREATE OR REPLACE FUNCTION public.p2p_system_message(p_trade_id UUID, p_body TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.p2p_messages (trade_id, sender_id, sender_username, kind, body)
  VALUES (p_trade_id, NULL, 'System', 'system', p_body);
$$;

-- ---------------------------------------------------------------------------
-- 7. Order lifecycle
-- ---------------------------------------------------------------------------

-- Create an order. A SELL order escrows the full amount immediately, so a
-- listing on the book is always backed by AX the maker actually holds.
CREATE OR REPLACE FUNCTION public.p2p_create_order(
  p_side            TEXT,
  p_price_pkr       NUMERIC,
  p_total_ax        BIGINT,
  p_min_ax          BIGINT,
  p_max_ax          BIGINT,
  p_payment_methods TEXT[],
  p_terms           TEXT DEFAULT NULL
)
RETURNS public.p2p_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid      UUID := auth.uid();
  uname    TEXT;
  bal      BIGINT;
  new_row  public.p2p_orders;
  min_ax   BIGINT := GREATEST(COALESCE(p_min_ax, 1), 1);
  max_ax   BIGINT := LEAST(COALESCE(NULLIF(p_max_ax, 0), p_total_ax), p_total_ax);
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF p_side NOT IN ('sell', 'buy') THEN RAISE EXCEPTION 'Invalid side'; END IF;
  IF p_total_ax IS NULL OR p_total_ax <= 0 THEN RAISE EXCEPTION 'Amount must be greater than zero'; END IF;
  IF p_price_pkr IS NULL OR p_price_pkr <= 0 THEN RAISE EXCEPTION 'Price must be greater than zero'; END IF;
  IF COALESCE(array_length(p_payment_methods, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Pick at least one payment method';
  END IF;
  IF min_ax > max_ax THEN RAISE EXCEPTION 'Minimum order cannot exceed the maximum'; END IF;

  SELECT username, balance INTO uname, bal
  FROM public.users WHERE id = uid FOR UPDATE;
  IF uname IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF;

  IF p_side = 'sell' THEN
    IF bal < p_total_ax THEN
      RAISE EXCEPTION 'Insufficient AX balance: you have %, listing needs %', bal, p_total_ax;
    END IF;
    UPDATE public.users
       SET balance = balance - p_total_ax,
           escrow_ax = escrow_ax + p_total_ax
     WHERE id = uid;
  END IF;

  INSERT INTO public.p2p_orders (
    maker_id, maker_username, side, price_pkr, total_ax, remaining_ax,
    min_ax, max_ax, payment_methods, terms
  )
  VALUES (
    uid, uname, p_side, p_price_pkr, p_total_ax, p_total_ax,
    min_ax, max_ax, p_payment_methods, NULLIF(btrim(COALESCE(p_terms, '')), '')
  )
  RETURNING * INTO new_row;

  RETURN new_row;
END;
$$;

-- Close an order and return any still-escrowed AX to the maker's balance.
CREATE OR REPLACE FUNCTION public.p2p_cancel_order(p_order_id UUID)
RETURNS public.p2p_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  o   public.p2p_orders;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;

  SELECT * INTO o FROM public.p2p_orders WHERE id = p_order_id FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF o.maker_id <> uid THEN RAISE EXCEPTION 'That is not your order'; END IF;
  IF o.status = 'closed' THEN RETURN o; END IF;

  IF o.side = 'sell' AND o.remaining_ax > 0 THEN
    UPDATE public.users
       SET balance = balance + o.remaining_ax,
           escrow_ax = GREATEST(escrow_ax - o.remaining_ax, 0)
     WHERE id = uid;
  END IF;

  UPDATE public.p2p_orders
     SET status = 'closed', closed_by_maker = true, remaining_ax = 0, updated_at = now()
   WHERE id = p_order_id
  RETURNING * INTO o;

  RETURN o;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Trade lifecycle
-- ---------------------------------------------------------------------------

-- Take an order. Reserves the AX out of the order and, when the taker is the
-- one selling, escrows it out of the taker's balance.
CREATE OR REPLACE FUNCTION public.p2p_open_trade(
  p_order_id       UUID,
  p_amount_ax      BIGINT,
  p_payment_method TEXT
)
RETURNS public.p2p_trades
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid        UUID := auth.uid();
  uname      TEXT;
  bal        BIGINT;
  o          public.p2p_orders;
  t          public.p2p_trades;
  v_buyer    UUID;
  v_seller   UUID;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;

  SELECT * INTO o FROM public.p2p_orders WHERE id = p_order_id FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF o.status <> 'active' THEN RAISE EXCEPTION 'This order is no longer active'; END IF;
  IF o.maker_id = uid THEN RAISE EXCEPTION 'You cannot trade against your own order'; END IF;

  IF p_amount_ax IS NULL OR p_amount_ax <= 0 THEN RAISE EXCEPTION 'Enter an amount'; END IF;
  IF p_amount_ax > o.remaining_ax THEN
    RAISE EXCEPTION 'Only % AX left on this order', o.remaining_ax;
  END IF;
  IF p_amount_ax < o.min_ax THEN
    RAISE EXCEPTION 'Minimum order is % AX', o.min_ax;
  END IF;
  IF p_amount_ax > o.max_ax THEN
    RAISE EXCEPTION 'Maximum order is % AX', o.max_ax;
  END IF;
  IF NOT (p_payment_method = ANY (o.payment_methods)) THEN
    RAISE EXCEPTION 'This order does not accept %', p_payment_method;
  END IF;

  SELECT username, balance INTO uname, bal
  FROM public.users WHERE id = uid FOR UPDATE;
  IF uname IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF;

  IF o.side = 'sell' THEN
    -- maker listed AX for sale; the AX is already escrowed against the order
    v_seller := o.maker_id;
    v_buyer  := uid;
  ELSE
    -- maker wants to buy AX; the taker is the seller and escrows now
    v_seller := uid;
    v_buyer  := o.maker_id;
    IF bal < p_amount_ax THEN
      RAISE EXCEPTION 'Insufficient AX balance: you have %, this trade needs %', bal, p_amount_ax;
    END IF;
    UPDATE public.users
       SET balance = balance - p_amount_ax,
           escrow_ax = escrow_ax + p_amount_ax
     WHERE id = uid;
  END IF;

  UPDATE public.p2p_orders
     SET remaining_ax = remaining_ax - p_amount_ax,
         status = CASE WHEN remaining_ax - p_amount_ax = 0 THEN 'closed' ELSE status END,
         updated_at = now()
   WHERE id = o.id;

  INSERT INTO public.p2p_trades (
    ref, order_id, maker_id, maker_username, taker_id, taker_username,
    buyer_id, seller_id, amount_ax, price_pkr, total_pkr, payment_method
  )
  VALUES (
    'AX-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8)),
    o.id, o.maker_id, o.maker_username, uid, uname,
    v_buyer, v_seller, p_amount_ax, o.price_pkr,
    round(p_amount_ax * o.price_pkr, 2), p_payment_method
  )
  RETURNING * INTO t;

  PERFORM public.p2p_system_message(
    t.id,
    format('Trade opened for %s AX at PKR %s via %s. %s AX is held in escrow until the seller confirms payment.',
           t.amount_ax, t.price_pkr, t.payment_method, t.amount_ax)
  );

  RETURN t;
END;
$$;

-- Buyer marks the PKR as sent, optionally attaching a payment screenshot.
CREATE OR REPLACE FUNCTION public.p2p_mark_paid(p_trade_id UUID, p_proof_url TEXT DEFAULT NULL)
RETURNS public.p2p_trades
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  t   public.p2p_trades;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;

  SELECT * INTO t FROM public.p2p_trades WHERE id = p_trade_id FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Trade not found'; END IF;
  IF t.buyer_id <> uid THEN RAISE EXCEPTION 'Only the buyer can mark a trade as paid'; END IF;
  IF t.status <> 'pending_payment' THEN
    RAISE EXCEPTION 'Trade is already %', t.status;
  END IF;

  UPDATE public.p2p_trades
     SET status = 'paid',
         paid_at = now(),
         payment_proof_url = COALESCE(NULLIF(p_proof_url, ''), payment_proof_url)
   WHERE id = p_trade_id
  RETURNING * INTO t;

  PERFORM public.p2p_system_message(
    t.id,
    CASE WHEN t.payment_proof_url IS NULL
      THEN 'Buyer marked the payment as sent. Waiting for the seller to confirm.'
      ELSE 'Buyer marked the payment as sent and attached a receipt. Waiting for the seller to confirm.'
    END
  );

  RETURN t;
END;
$$;

-- Seller confirms receipt; escrow moves to the buyer. This is the only path
-- by which escrowed AX becomes spendable balance for a counterparty.
CREATE OR REPLACE FUNCTION public.p2p_release(p_trade_id UUID)
RETURNS public.p2p_trades
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  t   public.p2p_trades;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;

  SELECT * INTO t FROM public.p2p_trades WHERE id = p_trade_id FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Trade not found'; END IF;
  IF t.seller_id <> uid THEN RAISE EXCEPTION 'Only the seller can release AX'; END IF;
  IF t.status NOT IN ('pending_payment', 'paid') THEN
    RAISE EXCEPTION 'Trade is already %', t.status;
  END IF;

  UPDATE public.users
     SET escrow_ax = GREATEST(escrow_ax - t.amount_ax, 0)
   WHERE id = t.seller_id;

  UPDATE public.users
     SET balance = balance + t.amount_ax
   WHERE id = t.buyer_id;

  UPDATE public.p2p_trades
     SET status = 'completed', completed_at = now()
   WHERE id = p_trade_id
  RETURNING * INTO t;

  PERFORM public.p2p_system_message(
    t.id, format('Seller released %s AX. Trade complete.', t.amount_ax)
  );

  RETURN t;
END;
$$;

-- Cancel before payment is confirmed. Escrow and order capacity are restored.
CREATE OR REPLACE FUNCTION public.p2p_cancel_trade(p_trade_id UUID)
RETURNS public.p2p_trades
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  t   public.p2p_trades;
  o   public.p2p_orders;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;

  SELECT * INTO t FROM public.p2p_trades WHERE id = p_trade_id FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Trade not found'; END IF;
  IF uid NOT IN (t.maker_id, t.taker_id) THEN RAISE EXCEPTION 'Not your trade'; END IF;
  IF t.status = 'cancelled' THEN RETURN t; END IF;
  IF t.status <> 'pending_payment' THEN
    RAISE EXCEPTION 'A trade can only be cancelled before the payment is marked as sent';
  END IF;
  -- once the buyer has paid nothing here can run; before that, only the buyer
  -- may back out unilaterally, or the seller once the payment window has passed
  IF uid = t.seller_id AND now() < t.expires_at THEN
    RAISE EXCEPTION 'You can only cancel after the buyer''s payment window expires';
  END IF;

  SELECT * INTO o FROM public.p2p_orders WHERE id = t.order_id FOR UPDATE;

  IF o.closed_by_maker THEN
    -- The order was withdrawn while this trade was open, so its capacity is
    -- gone for good. Whoever is holding the escrow gets it back as balance.
    UPDATE public.users
       SET balance = balance + t.amount_ax,
           escrow_ax = GREATEST(escrow_ax - t.amount_ax, 0)
     WHERE id = t.seller_id;
  ELSIF o.side = 'buy' THEN
    -- The taker was the seller and escrowed at trade time; refund them and
    -- put the capacity back on the maker's still-live buy order.
    UPDATE public.users
       SET balance = balance + t.amount_ax,
           escrow_ax = GREATEST(escrow_ax - t.amount_ax, 0)
     WHERE id = t.seller_id;

    UPDATE public.p2p_orders
       SET remaining_ax = remaining_ax + t.amount_ax,
           status = CASE WHEN status = 'closed' THEN 'active' ELSE status END,
           updated_at = now()
     WHERE id = o.id;
  ELSE
    -- Maker is the seller: their AX stays escrowed and simply goes back on
    -- the book as available capacity.
    UPDATE public.p2p_orders
       SET remaining_ax = remaining_ax + t.amount_ax,
           status = CASE WHEN status = 'closed' THEN 'active' ELSE status END,
           updated_at = now()
     WHERE id = o.id;
  END IF;

  UPDATE public.p2p_trades
     SET status = 'cancelled', cancelled_at = now()
   WHERE id = p_trade_id
  RETURNING * INTO t;

  PERFORM public.p2p_system_message(t.id, 'Trade cancelled. Escrow returned.');

  RETURN t;
END;
$$;

-- File a scam report. Freezes the trade so neither side can release or cancel
-- while an admin looks at it.
CREATE OR REPLACE FUNCTION public.p2p_report(
  p_trade_id     UUID,
  p_reason       TEXT,
  p_details      TEXT DEFAULT NULL,
  p_evidence_url TEXT DEFAULT NULL
)
RETURNS public.p2p_disputes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid      UUID := auth.uid();
  uname    TEXT;
  t        public.p2p_trades;
  accused  UUID;
  d        public.p2p_disputes;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'Pick a reason'; END IF;

  SELECT * INTO t FROM public.p2p_trades WHERE id = p_trade_id FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Trade not found'; END IF;
  IF uid NOT IN (t.maker_id, t.taker_id) THEN RAISE EXCEPTION 'Not your trade'; END IF;
  IF t.status = 'cancelled' THEN RAISE EXCEPTION 'This trade was cancelled'; END IF;

  accused := CASE WHEN uid = t.buyer_id THEN t.seller_id ELSE t.buyer_id END;
  uname := public.p2p_username(uid);

  IF EXISTS (SELECT 1 FROM public.p2p_disputes
              WHERE trade_id = p_trade_id AND reporter_id = uid AND status IN ('open', 'reviewing')) THEN
    RAISE EXCEPTION 'You already have an open report on this trade';
  END IF;

  INSERT INTO public.p2p_disputes (
    trade_id, reporter_id, reporter_username, accused_id, reason, details, evidence_url
  )
  VALUES (
    p_trade_id, uid, uname, accused, p_reason,
    NULLIF(btrim(COALESCE(p_details, '')), ''),
    NULLIF(p_evidence_url, '')
  )
  RETURNING * INTO d;

  -- a completed trade can still be reported, but it is not re-frozen
  IF t.status IN ('pending_payment', 'paid') THEN
    UPDATE public.p2p_trades SET status = 'disputed' WHERE id = p_trade_id;
  END IF;

  PERFORM public.p2p_system_message(
    p_trade_id,
    format('%s reported this trade: %s. Escrow is frozen pending review.', uname, p_reason)
  );

  RETURN d;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Read helpers
-- ---------------------------------------------------------------------------

-- Public trade stats for a maker, so takers can judge who they are dealing with
-- without the users table being readable.
CREATE OR REPLACE FUNCTION public.p2p_trader_stats(p_uid UUID)
RETURNS TABLE (username TEXT, completed BIGINT, disputes BIGINT, member_since TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.p2p_username(p_uid),
    (SELECT count(*) FROM public.p2p_trades
      WHERE status = 'completed' AND (maker_id = p_uid OR taker_id = p_uid)),
    (SELECT count(*) FROM public.p2p_disputes
      WHERE accused_id = p_uid AND status IN ('open', 'reviewing', 'resolved')),
    (SELECT created_at FROM public.users WHERE id = p_uid);
$$;

GRANT EXECUTE ON FUNCTION public.p2p_create_order(TEXT, NUMERIC, BIGINT, BIGINT, BIGINT, TEXT[], TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_cancel_order(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_open_trade(UUID, BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_mark_paid(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_release(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_cancel_trade(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_report(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_trader_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_is_participant(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 10. Storage: payment screenshots and dispute evidence
--     Private bucket. Files live under <trade_id>/<file>, and only that trade's
--     two counterparties can read them.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('p2p-proofs', 'p2p-proofs', false, 5242880,
        ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "p2p proof upload" ON storage.objects;
CREATE POLICY "p2p proof upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'p2p-proofs'
    -- guard the cast: a non-UUID folder must deny, not raise
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.p2p_is_participant((storage.foldername(name))[1]::UUID)
  );

DROP POLICY IF EXISTS "p2p proof read" ON storage.objects;
CREATE POLICY "p2p proof read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'p2p-proofs'
    -- guard the cast: a non-UUID folder must deny, not raise
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.p2p_is_participant((storage.foldername(name))[1]::UUID)
  );
