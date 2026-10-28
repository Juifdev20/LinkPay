-- ============================================================================
-- 088_exchange_bureau.sql — Bureau d'échange : convertir CDF <-> USD dans le portefeuille.
--
-- IMPORTANT — regulatory note: the exchange of currencies is regulated by the Banque Centrale du Congo (BCC).
-- Offering it to the public with a margin normally requires an approval (bank, payment institution or licensed
-- exchange office) or a partnership with an approved institution. This migration builds the technical architecture
-- only. The service is delivered SWITCHED OFF (exchange_settings.enabled = false): the super admin turns it on
-- once the legal point is settled.
--
-- How it works
--   * The super admin sets TWO rates, like a real exchange office:
--       buy_rate  = CDF given to a client for 1 USD   (the client gives USD, we "buy" the dollar)
--       sell_rate = CDF a client pays for 1 USD       (the client gives CDF, we "sell" the dollar)
--     buy_rate <= sell_rate: the difference is ScanLinkPay's gain. market_rate (optional) is the reference used to
--     measure that gain per exchange.
--   * A client asks for a QUOTE (rate guaranteed 60 s), then confirms with the PIN: execute_exchange() debits one
--     currency and credits the other in ONE transaction, after re-checking the limits under the wallet lock.
--   * Only accounts the team approved (exchange_verifications) may exchange.
--   * Amounts: cents of the wallet's currency, like everywhere else. USD cents x rate = CDF cents. CDF amounts
--     are whole francs (a multiple of 100 cents); what the client receives is rounded DOWN.
--
-- Run once in the Supabase SQL editor, after 087. Re-runnable.
-- ============================================================================

ALTER TYPE ledger_entry_type ADD VALUE IF NOT EXISTS 'EXCHANGE_OUT';
ALTER TYPE ledger_entry_type ADD VALUE IF NOT EXISTS 'EXCHANGE_IN';

-- ----------------------------------------------------------------------------
-- exchange_settings — the single row (id = 1) the super admin edits
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exchange_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  buy_rate NUMERIC(14, 2) CHECK (buy_rate IS NULL OR buy_rate > 0),
  sell_rate NUMERIC(14, 2) CHECK (sell_rate IS NULL OR sell_rate > 0),
  market_rate NUMERIC(14, 2) CHECK (market_rate IS NULL OR market_rate > 0),
  rates_updated_at TIMESTAMPTZ,
  rates_updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (buy_rate IS NULL OR sell_rate IS NULL OR buy_rate <= sell_rate)
);
INSERT INTO exchange_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE exchange_settings ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- exchange_limits — per currency GIVEN by the client. NULL = no limit.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exchange_limits (
  currency VARCHAR(3) PRIMARY KEY CHECK (currency IN ('CDF', 'USD')),
  min_cents BIGINT CHECK (min_cents IS NULL OR min_cents >= 0),
  max_cents BIGINT CHECK (max_cents IS NULL OR max_cents > 0),
  daily_max_cents BIGINT CHECK (daily_max_cents IS NULL OR daily_max_cents > 0),
  monthly_max_cents BIGINT CHECK (monthly_max_cents IS NULL OR monthly_max_cents > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
-- Only a floor to start with (1 $ / 3 000 FC); the ceilings are decided with the team.
INSERT INTO exchange_limits (currency, min_cents) VALUES ('USD', 100), ('CDF', 300000) ON CONFLICT (currency) DO NOTHING;
ALTER TABLE exchange_limits ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- exchange_rate_history — every change of rates: who, when, before and after
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exchange_rate_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  buy_rate NUMERIC(14, 2) NOT NULL,
  sell_rate NUMERIC(14, 2) NOT NULL,
  market_rate NUMERIC(14, 2),
  previous_buy_rate NUMERIC(14, 2),
  previous_sell_rate NUMERIC(14, 2),
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS exchange_rate_history_recent ON exchange_rate_history (created_at DESC);
ALTER TABLE exchange_rate_history ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- exchange_verifications — the accounts the team allowed to exchange (v1: validated by hand)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exchange_verifications (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS exchange_verifications_status ON exchange_verifications (status, requested_at);
ALTER TABLE exchange_verifications ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- exchange_quotes — a rate guaranteed for 60 s, used at most once
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exchange_quotes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  from_currency VARCHAR(3) NOT NULL CHECK (from_currency IN ('CDF', 'USD')),
  to_currency VARCHAR(3) NOT NULL CHECK (to_currency IN ('CDF', 'USD')),
  from_cents BIGINT NOT NULL CHECK (from_cents > 0),
  to_cents BIGINT NOT NULL CHECK (to_cents > 0),
  rate NUMERIC(14, 2) NOT NULL,          -- CDF for 1 USD, as applied to this quote
  market_rate NUMERIC(14, 2) NOT NULL,   -- the reference at that moment
  gain_cdf_cents BIGINT NOT NULL,        -- ScanLinkPay's gain, in CDF cents, measured against market_rate
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (from_currency <> to_currency)
);
CREATE INDEX IF NOT EXISTS exchange_quotes_expiry ON exchange_quotes (expires_at);
ALTER TABLE exchange_quotes ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- exchanges — the completed conversions
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS exchange_reference_seq START 1;

CREATE TABLE IF NOT EXISTS exchanges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference VARCHAR(20) NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  quote_id UUID NOT NULL UNIQUE REFERENCES exchange_quotes(id),
  from_currency VARCHAR(3) NOT NULL CHECK (from_currency IN ('CDF', 'USD')),
  to_currency VARCHAR(3) NOT NULL CHECK (to_currency IN ('CDF', 'USD')),
  from_cents BIGINT NOT NULL CHECK (from_cents > 0),
  to_cents BIGINT NOT NULL CHECK (to_cents > 0),
  rate NUMERIC(14, 2) NOT NULL,
  market_rate NUMERIC(14, 2) NOT NULL,
  gain_cdf_cents BIGINT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  is_test BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (from_currency <> to_currency)
);
CREATE INDEX IF NOT EXISTS exchanges_wallet_recent ON exchanges (wallet_id, from_currency, created_at DESC);
CREATE INDEX IF NOT EXISTS exchanges_recent ON exchanges (created_at DESC);
ALTER TABLE exchanges ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- Pure arithmetic, in one place (the app shows the same numbers, see linkpay-web/src/lib/exchange.ts)
-- ----------------------------------------------------------------------------
-- Day / month windows are in Kinshasa time (WAT): "today" is the client's day.
CREATE OR REPLACE FUNCTION public.exchange_day_start() RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE AS $$ SELECT date_trunc('day', NOW() AT TIME ZONE 'Africa/Kinshasa') AT TIME ZONE 'Africa/Kinshasa' $$;

CREATE OR REPLACE FUNCTION public.exchange_month_start() RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE AS $$ SELECT date_trunc('month', NOW() AT TIME ZONE 'Africa/Kinshasa') AT TIME ZONE 'Africa/Kinshasa' $$;

-- What a client gets for p_from_cents of p_from, and what ScanLinkPay gains (CDF cents, against the market rate).
CREATE OR REPLACE FUNCTION public.exchange_compute(
  p_from VARCHAR, p_from_cents BIGINT, p_buy NUMERIC, p_sell NUMERIC, p_market NUMERIC,
  OUT rate NUMERIC, OUT to_cents BIGINT, OUT gain_cdf_cents BIGINT
) LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_from = 'USD' THEN
    -- The client gives dollars and receives francs, at the BUY rate; whole francs, rounded down.
    rate := p_buy;
    to_cents := FLOOR(p_from_cents * p_buy / 100)::BIGINT * 100;
    gain_cdf_cents := FLOOR(p_from_cents * p_market - to_cents)::BIGINT;
  ELSE
    -- The client gives francs and receives dollars, at the SELL rate; cents, rounded down.
    rate := p_sell;
    to_cents := FLOOR(p_from_cents / p_sell)::BIGINT;
    gain_cdf_cents := FLOOR(p_from_cents - to_cents * p_market)::BIGINT;
  END IF;
END;
$$;

-- Raises EXCHANGE_MIN:<cents> / EXCHANGE_MAX:<cents> / EXCHANGE_DAILY:<cents left> / EXCHANGE_MONTHLY:<cents left>.
-- Called under the wallet lock (execute_exchange) so two exchanges at once cannot both slip under a ceiling.
CREATE OR REPLACE FUNCTION public.exchange_check_limits(p_wallet UUID, p_currency VARCHAR, p_cents BIGINT)
RETURNS VOID
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  l exchange_limits;
  v_used BIGINT;
BEGIN
  SELECT * INTO l FROM exchange_limits WHERE currency = p_currency;
  IF NOT FOUND THEN RETURN; END IF;

  IF l.min_cents IS NOT NULL AND p_cents < l.min_cents THEN RAISE EXCEPTION 'EXCHANGE_MIN:%', l.min_cents; END IF;
  IF l.max_cents IS NOT NULL AND p_cents > l.max_cents THEN RAISE EXCEPTION 'EXCHANGE_MAX:%', l.max_cents; END IF;

  IF l.daily_max_cents IS NOT NULL THEN
    SELECT COALESCE(SUM(from_cents), 0) INTO v_used FROM exchanges
     WHERE wallet_id = p_wallet AND from_currency = p_currency AND created_at >= exchange_day_start();
    IF v_used + p_cents > l.daily_max_cents THEN RAISE EXCEPTION 'EXCHANGE_DAILY:%', GREATEST(l.daily_max_cents - v_used, 0); END IF;
  END IF;

  IF l.monthly_max_cents IS NOT NULL THEN
    SELECT COALESCE(SUM(from_cents), 0) INTO v_used FROM exchanges
     WHERE wallet_id = p_wallet AND from_currency = p_currency AND created_at >= exchange_month_start();
    IF v_used + p_cents > l.monthly_max_cents THEN RAISE EXCEPTION 'EXCHANGE_MONTHLY:%', GREATEST(l.monthly_max_cents - v_used, 0); END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- create_exchange_quote — validates everything the client can be told about early, then fixes the rate for 60 s
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_exchange_quote(
  p_user UUID, p_wallet UUID, p_from VARCHAR, p_to VARCHAR, p_from_cents BIGINT
) RETURNS exchange_quotes
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s exchange_settings;
  c RECORD;
  v_market NUMERIC;
  v_balance BIGINT;
  q exchange_quotes;
BEGIN
  IF p_from NOT IN ('CDF', 'USD') OR p_to NOT IN ('CDF', 'USD') OR p_from = p_to THEN RAISE EXCEPTION 'EXCHANGE_INVALID_PAIR'; END IF;
  IF p_from_cents IS NULL OR p_from_cents <= 0 THEN RAISE EXCEPTION 'EXCHANGE_INVALID_AMOUNT'; END IF;
  IF p_from = 'CDF' AND p_from_cents % 100 <> 0 THEN RAISE EXCEPTION 'EXCHANGE_CDF_WHOLE'; END IF;

  SELECT * INTO s FROM exchange_settings WHERE id = 1;
  IF NOT FOUND OR NOT s.enabled THEN RAISE EXCEPTION 'EXCHANGE_DISABLED'; END IF;
  IF s.buy_rate IS NULL OR s.sell_rate IS NULL OR s.rates_updated_at IS NULL OR s.rates_updated_at < NOW() - INTERVAL '24 hours' THEN
    RAISE EXCEPTION 'EXCHANGE_RATES_STALE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM exchange_verifications WHERE user_id = p_user AND status = 'approved') THEN
    RAISE EXCEPTION 'EXCHANGE_NOT_VERIFIED';
  END IF;
  PERFORM 1 FROM wallets WHERE id = p_wallet AND user_id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXCHANGE_WALLET_NOT_FOUND'; END IF;

  PERFORM exchange_check_limits(p_wallet, p_from, p_from_cents);

  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END), 0) INTO v_balance
    FROM ledger_entries WHERE wallet_id = p_wallet AND currency = p_from;
  IF v_balance < p_from_cents THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

  v_market := COALESCE(s.market_rate, (s.buy_rate + s.sell_rate) / 2);
  SELECT * INTO c FROM exchange_compute(p_from, p_from_cents, s.buy_rate, s.sell_rate, v_market);
  IF c.to_cents < 1 THEN RAISE EXCEPTION 'EXCHANGE_TOO_SMALL'; END IF;

  -- Old quotes are of no use to anybody: tidy up as we go.
  DELETE FROM exchange_quotes WHERE expires_at < NOW() - INTERVAL '1 day';

  INSERT INTO exchange_quotes (user_id, wallet_id, from_currency, to_currency, from_cents, to_cents, rate, market_rate, gain_cdf_cents, expires_at)
  VALUES (p_user, p_wallet, p_from, p_to, p_from_cents, c.to_cents, c.rate, v_market, c.gain_cdf_cents, NOW() + INTERVAL '60 seconds')
  RETURNING * INTO q;
  RETURN q;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- execute_exchange — debit + credit + record, atomically. Idempotent on p_idempotency_key.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.execute_exchange(
  p_user UUID, p_wallet UUID, p_quote UUID, p_idempotency_key TEXT
) RETURNS exchanges
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  q exchange_quotes;
  s exchange_settings;
  ex exchanges;
  v_ref TEXT;
  v_test BOOLEAN;
BEGIN
  SELECT * INTO ex FROM exchanges WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF ex.wallet_id <> p_wallet OR ex.quote_id <> p_quote THEN RAISE EXCEPTION 'EXCHANGE_KEY_REUSED'; END IF;
    RETURN ex;
  END IF;

  -- The wallet lock serialises everything below for this wallet: the limits are checked against what is really there.
  SELECT is_test INTO v_test FROM wallets WHERE id = p_wallet AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXCHANGE_WALLET_NOT_FOUND'; END IF;

  -- The same request may have been waiting for the lock: its twin has just finished.
  SELECT * INTO ex FROM exchanges WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF ex.wallet_id <> p_wallet OR ex.quote_id <> p_quote THEN RAISE EXCEPTION 'EXCHANGE_KEY_REUSED'; END IF;
    RETURN ex;
  END IF;

  SELECT * INTO q FROM exchange_quotes WHERE id = p_quote FOR UPDATE;
  IF NOT FOUND OR q.user_id <> p_user OR q.wallet_id <> p_wallet THEN RAISE EXCEPTION 'EXCHANGE_QUOTE_NOT_FOUND'; END IF;
  IF q.used_at IS NOT NULL THEN RAISE EXCEPTION 'EXCHANGE_QUOTE_USED'; END IF;
  IF q.expires_at < NOW() THEN RAISE EXCEPTION 'EXCHANGE_QUOTE_EXPIRED'; END IF;

  SELECT * INTO s FROM exchange_settings WHERE id = 1;
  IF NOT FOUND OR NOT s.enabled THEN RAISE EXCEPTION 'EXCHANGE_DISABLED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM exchange_verifications WHERE user_id = p_user AND status = 'approved') THEN
    RAISE EXCEPTION 'EXCHANGE_NOT_VERIFIED';
  END IF;

  PERFORM exchange_check_limits(p_wallet, q.from_currency, q.from_cents);

  v_ref := 'EX-' || lpad(nextval('exchange_reference_seq')::TEXT, 6, '0');

  -- Raises 'Insufficient balance' when the wallet does not hold from_cents: everything above rolls back with it.
  PERFORM debit_wallet(p_wallet, q.from_cents, 'EXCHANGE_OUT', v_ref, q.from_currency,
    jsonb_build_object('exchange_quote_id', q.id, 'to_currency', q.to_currency, 'to_cents', q.to_cents, 'rate', q.rate));
  PERFORM credit_wallet(p_wallet, q.to_cents, 'EXCHANGE_IN', v_ref, q.to_currency,
    jsonb_build_object('exchange_quote_id', q.id, 'from_currency', q.from_currency, 'from_cents', q.from_cents, 'rate', q.rate));

  INSERT INTO exchanges (reference, user_id, wallet_id, quote_id, from_currency, to_currency, from_cents, to_cents, rate, market_rate, gain_cdf_cents, idempotency_key, is_test)
  VALUES (v_ref, p_user, p_wallet, q.id, q.from_currency, q.to_currency, q.from_cents, q.to_cents, q.rate, q.market_rate, q.gain_cdf_cents, p_idempotency_key, COALESCE(v_test, FALSE))
  RETURNING * INTO ex;

  UPDATE exchange_quotes SET used_at = NOW() WHERE id = q.id;
  RETURN ex;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- Figures for the admin page (real wallets only: test money earns nothing)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exchange_stats()
RETURNS TABLE (
  gain_today_cdf_cents BIGINT, gain_7d_cdf_cents BIGINT,
  count_today INT, count_7d INT,
  volume_7d_usd_cents BIGINT,
  gain_total_cdf_cents BIGINT
)
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(gain_cdf_cents) FILTER (WHERE created_at >= exchange_day_start()), 0)::BIGINT,
    COALESCE(SUM(gain_cdf_cents) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'), 0)::BIGINT,
    (COUNT(*) FILTER (WHERE created_at >= exchange_day_start()))::INT,
    (COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'))::INT,
    COALESCE(SUM(CASE WHEN from_currency = 'USD' THEN from_cents ELSE to_cents END) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'), 0)::BIGINT,
    COALESCE(SUM(gain_cdf_cents), 0)::BIGINT
  FROM exchanges WHERE NOT is_test
$$ LANGUAGE sql STABLE;

-- What each wallet has already exchanged today / this month, per currency given (for "Reste aujourd'hui").
CREATE OR REPLACE FUNCTION public.exchange_usage(p_wallet UUID)
RETURNS TABLE (currency VARCHAR, day_cents BIGINT, month_cents BIGINT)
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.cur,
    COALESCE((SELECT SUM(from_cents) FROM exchanges WHERE wallet_id = p_wallet AND from_currency = c.cur AND created_at >= exchange_day_start()), 0)::BIGINT,
    COALESCE((SELECT SUM(from_cents) FROM exchanges WHERE wallet_id = p_wallet AND from_currency = c.cur AND created_at >= exchange_month_start()), 0)::BIGINT
  FROM (VALUES ('CDF'::VARCHAR), ('USD'::VARCHAR)) AS c(cur)
$$ LANGUAGE sql STABLE;

-- ----------------------------------------------------------------------------
-- Nobody but the API (service_role) may call these
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.exchange_check_limits(UUID, VARCHAR, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_exchange_quote(UUID, UUID, VARCHAR, VARCHAR, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.execute_exchange(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exchange_stats() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exchange_usage(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exchange_check_limits(UUID, VARCHAR, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_exchange_quote(UUID, UUID, VARCHAR, VARCHAR, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_exchange(UUID, UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.exchange_stats() TO service_role;
GRANT EXECUTE ON FUNCTION public.exchange_usage(UUID) TO service_role;
