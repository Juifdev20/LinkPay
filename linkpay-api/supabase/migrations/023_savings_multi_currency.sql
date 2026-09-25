-- ============================================================================
-- 023_savings_multi_currency.sql — Round-up savings becomes multi-currency:
-- one savings_pots row per (user, currency) instead of per user, each with
-- its own round_up_enabled/increment/goal — same "CDF and USD are fully
-- independent, never auto-converted" principle already used everywhere else
-- (see 008_multi_currency.sql). savings_pot_entries needs no change: each
-- pot row is now currency-specific, so its entries already are too.
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

ALTER TABLE savings_pots ADD COLUMN IF NOT EXISTS currency VARCHAR(10) NOT NULL DEFAULT 'CDF' CHECK (currency IN ('CDF', 'USD'));
-- Rows created before this migration were necessarily CDF (the only option
-- at the time) — the DEFAULT above backfills them correctly.

ALTER TABLE savings_pots DROP CONSTRAINT IF EXISTS savings_pots_user_id_key;
ALTER TABLE savings_pots ADD CONSTRAINT savings_pots_user_currency_unique UNIQUE (user_id, currency);

-- ----------------------------------------------------------------------------
-- round_up_to_savings / withdraw_from_savings_pot — signatures change (new
-- p_currency param), so the old versions must be dropped first: CREATE OR
-- REPLACE does not replace a function when the argument list changes, it
-- creates an ambiguous second overload instead (same pattern already
-- followed in 008_multi_currency.sql).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.round_up_to_savings(UUID, UUID, BIGINT, VARCHAR);
DROP FUNCTION IF EXISTS public.withdraw_from_savings_pot(UUID, UUID, BIGINT);

CREATE OR REPLACE FUNCTION public.round_up_to_savings(
  p_wallet_id UUID,
  p_user_id UUID,
  p_currency VARCHAR,
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
  SELECT id INTO v_pot_id FROM savings_pots WHERE user_id = p_user_id AND currency = p_currency AND round_up_enabled = TRUE;
  IF v_pot_id IS NULL THEN
    RAISE EXCEPTION 'No active % savings pot for user %', p_currency, p_user_id;
  END IF;

  PERFORM public.debit_wallet(p_wallet_id, p_amount_cents, 'ADJUSTMENT'::ledger_entry_type, p_reference, p_currency, jsonb_build_object('pot_id', v_pot_id, 'type', 'roundup_out'));

  INSERT INTO savings_pot_entries (pot_id, type, amount_cents, related_reference)
  VALUES (v_pot_id, 'round_up', p_amount_cents, p_reference);

  SELECT COALESCE(SUM(CASE WHEN type = 'round_up' THEN amount_cents ELSE -amount_cents END), 0)
    INTO v_balance
    FROM savings_pot_entries WHERE pot_id = v_pot_id;

  RETURN v_balance;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.withdraw_from_savings_pot(
  p_wallet_id UUID,
  p_user_id UUID,
  p_currency VARCHAR,
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

  SELECT id INTO v_pot_id FROM savings_pots WHERE user_id = p_user_id AND currency = p_currency FOR UPDATE;
  IF v_pot_id IS NULL THEN
    RAISE EXCEPTION 'No % savings pot for user %', p_currency, p_user_id;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN type = 'round_up' THEN amount_cents ELSE -amount_cents END), 0)
    INTO v_balance
    FROM savings_pot_entries WHERE pot_id = v_pot_id;

  IF v_balance < p_amount_cents THEN
    RAISE EXCEPTION 'Insufficient pot balance: has %, needs %', v_balance, p_amount_cents;
  END IF;

  INSERT INTO savings_pot_entries (pot_id, type, amount_cents) VALUES (v_pot_id, 'withdrawal', p_amount_cents);

  PERFORM public.credit_wallet(p_wallet_id, p_amount_cents, 'ADJUSTMENT'::ledger_entry_type, 'savings-withdrawal', p_currency, jsonb_build_object('pot_id', v_pot_id, 'type', 'roundup_in'));

  RETURN v_balance - p_amount_cents;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.round_up_to_savings(UUID, UUID, VARCHAR, BIGINT, VARCHAR) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.withdraw_from_savings_pot(UUID, UUID, VARCHAR, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.round_up_to_savings(UUID, UUID, VARCHAR, BIGINT, VARCHAR) TO service_role;
GRANT EXECUTE ON FUNCTION public.withdraw_from_savings_pot(UUID, UUID, VARCHAR, BIGINT) TO service_role;
