-- ============================================================================
-- 042_withdrawal_payouts.sql — Real withdrawals: state changes that can't be
-- applied twice.
--
-- A withdrawal now goes  PENDING (funds reserved, payout not yet accepted)
--                     -> PROCESSING (the payment provider accepted it)
--                     -> SUCCESS  (the provider confirmed the money was sent)
--                        or REVERSED (it failed: the wallet gets its money back).
--
-- Three things can try to settle the same withdrawal at once: the request
-- itself, the reconciliation job, and (later) the provider's callback. The
-- functions below lock the row, only act on a withdrawal that is still open,
-- and return NULL otherwise — so a withdrawal is refunded at most once and
-- can never be both paid and refunded.
--
-- Only the API (service_role) may call these.
-- Run once in the Supabase SQL editor, BEFORE deploying the API version that
-- calls them.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_withdrawals_open
  ON withdrawals(updated_at) WHERE status IN ('PENDING', 'PROCESSING');

-- ----------------------------------------------------------------------------
-- mark_withdrawal_processing: the provider accepted the payout (not final yet).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_withdrawal_processing(
  p_withdrawal_id UUID,
  p_psp_reference TEXT
) RETURNS withdrawals
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row withdrawals;
BEGIN
  UPDATE withdrawals
     SET status = 'PROCESSING',
         psp_reference = COALESCE(p_psp_reference, psp_reference),
         updated_at = NOW()
   WHERE id = p_withdrawal_id AND status = 'PENDING'
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- finish_withdrawal: the provider confirmed the money was sent.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finish_withdrawal(
  p_withdrawal_id UUID,
  p_psp_reference TEXT
) RETURNS withdrawals
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row withdrawals;
BEGIN
  UPDATE withdrawals
     SET status = 'SUCCESS',
         psp_reference = COALESCE(p_psp_reference, psp_reference),
         failure_reason = NULL,
         updated_at = NOW()
   WHERE id = p_withdrawal_id AND status IN ('PENDING', 'PROCESSING')
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- fail_withdrawal: the money was NOT sent — give the wallet back the amount
-- and the fee, in the same database transaction as the status change.
-- ----------------------------------------------------------------------------
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

  PERFORM credit_wallet(
    v_row.wallet_id, v_row.amount_cents + v_row.fee_cents, 'ADJUSTMENT',
    'WITHDRAWAL-REVERSAL-' || v_row.id, v_row.currency,
    jsonb_build_object('withdrawal_id', v_row.id, 'reason', p_reason)
  );

  UPDATE withdrawals
     SET status = 'REVERSED', failure_reason = p_reason, updated_at = NOW()
   WHERE id = p_withdrawal_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.mark_withdrawal_processing(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finish_withdrawal(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_withdrawal(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_withdrawal_processing(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_withdrawal(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_withdrawal(UUID, TEXT) TO service_role;
