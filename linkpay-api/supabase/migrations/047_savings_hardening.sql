-- ============================================================================
-- 047_savings_hardening.sql — Savings: wallet/user pairing and cheap balances.
--
-- 1. round_up_to_savings, withdraw_from_savings_pot and pay_expense_pro_via_wallet
--    take BOTH a wallet id and a user id and trusted the caller that they
--    match. The API always passes the caller's own wallet, but a function that
--    moves money should not depend on that: with a mismatched pair,
--    round_up_to_savings would debit ANY wallet into someone's pot, and
--    withdraw_from_savings_pot would pay a pot out to ANY wallet. Each now
--    refuses a wallet that doesn't belong to the user. (Before migration 043
--    those functions were also open to the public anon key, which made this
--    exploitable from outside; 043 closed that, this closes the logic.)
--
-- 2. savings_pot_balances(): the savings screen computed each pot's balance by
--    downloading EVERY entry ever recorded (one per round-up, so one per
--    payment) and summing them in the API. It is now a SUM in the database,
--    and the screen only fetches the 20 latest entries it displays.
--
-- Run once in the Supabase SQL editor, after 043. CREATE OR REPLACE keeps the
-- existing grants (service_role only).
-- ============================================================================

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
  PERFORM 1 FROM wallets WHERE id = p_wallet_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WALLET_USER_MISMATCH';
  END IF;

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

  PERFORM 1 FROM wallets WHERE id = p_wallet_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WALLET_USER_MISMATCH';
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

CREATE OR REPLACE FUNCTION public.pay_expense_pro_via_wallet(
  p_user_id UUID,
  p_wallet_id UUID,
  p_amount_cents BIGINT,
  p_currency VARCHAR,
  p_reference VARCHAR
) RETURNS TIMESTAMPTZ
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_expiry TIMESTAMPTZ;
BEGIN
  PERFORM 1 FROM wallets WHERE id = p_wallet_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WALLET_USER_MISMATCH';
  END IF;

  PERFORM public.debit_wallet(p_wallet_id, p_amount_cents, 'PLATFORM_FEE'::ledger_entry_type, p_reference, p_currency, jsonb_build_object('kind', 'expense_pro_subscription'));

  INSERT INTO expense_pro_status (user_id, trial_started_at, trial_ends_at, pro_expires_at)
  VALUES (p_user_id, NOW(), NOW(), NOW() + INTERVAL '30 days')
  ON CONFLICT (user_id) DO UPDATE
    SET pro_expires_at = GREATEST(NOW(), COALESCE(expense_pro_status.pro_expires_at, NOW())) + INTERVAL '30 days',
        updated_at = NOW()
  RETURNING pro_expires_at INTO v_new_expiry;

  RETURN v_new_expiry;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- savings_pot_balances: one SUM per pot, in the database.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.savings_pot_balances(p_user_id UUID)
RETURNS TABLE (currency VARCHAR, balance_cents BIGINT)
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.currency::VARCHAR,
         COALESCE(SUM(CASE WHEN e.type = 'round_up' THEN e.amount_cents ELSE -e.amount_cents END), 0)::BIGINT
    FROM savings_pots p
    LEFT JOIN savings_pot_entries e ON e.pot_id = p.id
   WHERE p.user_id = p_user_id
   GROUP BY p.currency;
$$ LANGUAGE sql STABLE;

REVOKE ALL ON FUNCTION public.savings_pot_balances(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.savings_pot_balances(UUID) TO service_role;
