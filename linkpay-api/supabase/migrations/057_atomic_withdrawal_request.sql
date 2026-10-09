-- ============================================================================
-- 057_atomic_withdrawal_request.sql — a withdrawal request and its debit happen together, or not at all.
--
-- Until now: INSERT the withdrawal (PENDING), then — as a separate call — debit the wallet. A crash or a
-- deploy between the two left a PENDING withdrawal that was never debited. Ten minutes later the payout
-- reconciliation found the provider knew nothing of it and "reversed" it: fail_withdrawal() credited the
-- wallet amount + fee that had never been taken — money created from nothing. Conversely a timeout on the
-- debit call (committed on the database, unknown to the API) was read as "insufficient balance": the
-- withdrawal was marked FAILED, never REVERSED, and the user's debit was never given back.
--
-- request_withdrawal() inserts and debits in ONE transaction (nothing exists if the balance is short), and
-- fail_withdrawal() only gives money back when a debit for this withdrawal really exists in the ledger.
--
-- API only. Run once in the Supabase SQL editor (after 056).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.request_withdrawal(
  p_wallet UUID,
  p_amount BIGINT,
  p_fee BIGINT,
  p_currency VARCHAR,
  p_channel TEXT,
  p_destination JSONB,
  p_psp_provider TEXT,
  p_idempotency_key TEXT
) RETURNS withdrawals
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_w withdrawals;
BEGIN
  IF p_amount < 1 OR p_fee < 0 THEN RAISE EXCEPTION 'WITHDRAWAL_INVALID_AMOUNT'; END IF;

  INSERT INTO withdrawals (wallet_id, amount_cents, fee_cents, currency, channel, destination, status, psp_provider, idempotency_key)
  VALUES (p_wallet, p_amount, p_fee, p_currency, p_channel, p_destination, 'PENDING', p_psp_provider, p_idempotency_key)
  RETURNING * INTO v_w;

  -- Raises 'Insufficient balance' when the wallet doesn't hold amount + fee: the INSERT above is rolled back with it.
  PERFORM debit_wallet(p_wallet, p_amount + p_fee, 'WITHDRAWAL', 'WITHDRAWAL-' || v_w.id, p_currency,
    jsonb_build_object('withdrawal_id', v_w.id, 'channel', p_channel));

  RETURN v_w;
END;
$$ LANGUAGE plpgsql;

-- Give the money back ONLY if it was taken. A withdrawal with no debit in the ledger is simply closed as failed.
CREATE OR REPLACE FUNCTION public.fail_withdrawal(
  p_withdrawal_id UUID,
  p_reason TEXT
) RETURNS withdrawals
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row withdrawals;
BEGIN
  SELECT * INTO v_row FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND OR v_row.status NOT IN ('PENDING', 'PROCESSING') THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM ledger_entries l
     WHERE l.wallet_id = v_row.wallet_id AND l.reference = 'WITHDRAWAL-' || v_row.id
       AND l.entry_type = 'WITHDRAWAL' AND l.direction = 'debit'
  ) THEN
    PERFORM credit_wallet(
      v_row.wallet_id, v_row.amount_cents + v_row.fee_cents, 'ADJUSTMENT',
      'WITHDRAWAL-REVERSAL-' || v_row.id, v_row.currency,
      jsonb_build_object('withdrawal_id', v_row.id, 'reason', p_reason)
    );
    UPDATE withdrawals SET status = 'REVERSED', failure_reason = p_reason, updated_at = NOW()
     WHERE id = p_withdrawal_id RETURNING * INTO v_row;
  ELSE
    -- Nothing was ever debited: there is nothing to give back.
    UPDATE withdrawals SET status = 'FAILED', failure_reason = p_reason, updated_at = NOW()
     WHERE id = p_withdrawal_id RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.request_withdrawal(UUID, BIGINT, BIGINT, VARCHAR, TEXT, JSONB, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_withdrawal(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(UUID, BIGINT, BIGINT, VARCHAR, TEXT, JSONB, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_withdrawal(UUID, TEXT) TO service_role;
