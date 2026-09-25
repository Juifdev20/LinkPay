-- ============================================================================
-- 022_savings_pots.sql — Round-up savings ("épargne par arrondi"), for both
-- client and merchant wallets. Opt-in, disabled by default. When enabled,
-- a payment/transfer is rounded up to the user's chosen increment (CDF
-- only — USD amounts are never rounded) and the difference moves into a
-- personal pot, separate from the spendable balance but freely withdrawable
-- at any time.
--
-- Deliberately NOT a second row in `wallets` — every existing flow
-- (login, payments, transfers) assumes exactly one wallet per user via
-- `.single()` queries; adding a second one would break all of them. Instead
-- this is its own small, ledger-style system: no stored balance anywhere
-- (same philosophy as wallets themselves), reusing the existing
-- credit_wallet/debit_wallet primitives for the real money movement against
-- the main wallet, with the 'ADJUSTMENT' entry type (already in
-- ledger_entry_type — no new enum value needed).
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

CREATE TABLE IF NOT EXISTS savings_pots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  round_up_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  round_up_increment_cents BIGINT NOT NULL DEFAULT 50000, -- 500 CDF
  goal_name TEXT,
  goal_amount_cents BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS savings_pot_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pot_id UUID NOT NULL REFERENCES savings_pots(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('round_up', 'withdrawal')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  related_reference TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_savings_pot_entries_pot ON savings_pot_entries(pot_id);

ALTER TABLE savings_pots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS savings_pots_select_own ON savings_pots;
CREATE POLICY savings_pots_select_own ON savings_pots FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

ALTER TABLE savings_pot_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS savings_pot_entries_select_own ON savings_pot_entries;
CREATE POLICY savings_pot_entries_select_own ON savings_pot_entries FOR SELECT USING (
  pot_id IN (SELECT id FROM savings_pots WHERE user_id = auth.uid())
  OR public.is_admin()
);

-- ----------------------------------------------------------------------------
-- round_up_to_savings — debits the main wallet (via debit_wallet, which
-- raises if the balance can't cover even this small extra amount — the
-- caller in application code catches that and just skips the round-up for
-- this payment, never blocking the payment itself) and records the pot
-- entry, atomically in one transaction.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.round_up_to_savings(
  p_wallet_id UUID,
  p_user_id UUID,
  p_amount_cents BIGINT,
  p_reference VARCHAR
) RETURNS BIGINT
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pot_id UUID;
  v_balance BIGINT;
BEGIN
  SELECT id INTO v_pot_id FROM savings_pots WHERE user_id = p_user_id AND round_up_enabled = TRUE;
  IF v_pot_id IS NULL THEN
    RAISE EXCEPTION 'No active savings pot for user %', p_user_id;
  END IF;

  PERFORM public.debit_wallet(p_wallet_id, p_amount_cents, 'ADJUSTMENT'::ledger_entry_type, p_reference, 'CDF', jsonb_build_object('pot_id', v_pot_id, 'type', 'roundup_out'));

  INSERT INTO savings_pot_entries (pot_id, type, amount_cents, related_reference)
  VALUES (v_pot_id, 'round_up', p_amount_cents, p_reference);

  SELECT COALESCE(SUM(CASE WHEN type = 'round_up' THEN amount_cents ELSE -amount_cents END), 0)
    INTO v_balance
    FROM savings_pot_entries WHERE pot_id = v_pot_id;

  RETURN v_balance;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- withdraw_from_savings_pot — the reverse: checks the pot's own (ledger-
-- derived) balance, records the withdrawal, then credits the main wallet.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.withdraw_from_savings_pot(
  p_wallet_id UUID,
  p_user_id UUID,
  p_amount_cents BIGINT
) RETURNS BIGINT
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pot_id UUID;
  v_balance BIGINT;
BEGIN
  IF p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'amount_cents must be positive';
  END IF;

  SELECT id INTO v_pot_id FROM savings_pots WHERE user_id = p_user_id FOR UPDATE;
  IF v_pot_id IS NULL THEN
    RAISE EXCEPTION 'No savings pot for user %', p_user_id;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN type = 'round_up' THEN amount_cents ELSE -amount_cents END), 0)
    INTO v_balance
    FROM savings_pot_entries WHERE pot_id = v_pot_id;

  IF v_balance < p_amount_cents THEN
    RAISE EXCEPTION 'Insufficient pot balance: has %, needs %', v_balance, p_amount_cents;
  END IF;

  INSERT INTO savings_pot_entries (pot_id, type, amount_cents) VALUES (v_pot_id, 'withdrawal', p_amount_cents);

  PERFORM public.credit_wallet(p_wallet_id, p_amount_cents, 'ADJUSTMENT'::ledger_entry_type, 'savings-withdrawal', 'CDF', jsonb_build_object('pot_id', v_pot_id, 'type', 'roundup_in'));

  RETURN v_balance - p_amount_cents;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.round_up_to_savings(UUID, UUID, BIGINT, VARCHAR) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.withdraw_from_savings_pot(UUID, UUID, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.round_up_to_savings(UUID, UUID, BIGINT, VARCHAR) TO service_role;
GRANT EXECUTE ON FUNCTION public.withdraw_from_savings_pot(UUID, UUID, BIGINT) TO service_role;
