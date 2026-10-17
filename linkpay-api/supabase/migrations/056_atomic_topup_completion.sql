-- ============================================================================
-- 056_atomic_topup_completion.sql — a top-up is credited exactly once.
--
-- A card/Mobile-Money top-up can be confirmed from several places at the same moment: the PSP webhook
-- (possibly delivered twice) and the status check the app makes when the user comes back from the payment
-- page. The webhook path used to read the status, credit the wallet, and only then mark the top-up SUCCESS:
-- two confirmations racing each other both read "not SUCCESS yet" and both credited. And when the credit
-- failed after the status had been claimed, the user's payment was never credited at all.
--
-- complete_topup() does it in ONE transaction under a row lock: the first caller credits the wallet and marks
-- the top-up SUCCESS; every later (or concurrent) caller finds it already SUCCESS and does nothing; if the
-- credit fails, nothing is claimed and the top-up stays PENDING, so the next confirmation can retry.
--
-- API only. Run once in the Supabase SQL editor (after 055).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.complete_topup(p_topup_id UUID, p_psp_intent_id TEXT DEFAULT NULL)
RETURNS TABLE (credited BOOLEAN, user_id UUID, amount_cents BIGINT, currency VARCHAR)
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t wallet_topups;
  v_user UUID;
BEGIN
  SELECT * INTO v_t FROM wallet_topups WHERE id = p_topup_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TOPUP_NOT_FOUND'; END IF;

  SELECT w.user_id INTO v_user FROM wallets w WHERE w.id = v_t.wallet_id;

  IF v_t.status = 'SUCCESS' THEN
    RETURN QUERY SELECT FALSE, v_user, v_t.amount_cents, v_t.currency;
    RETURN;
  END IF;

  -- Belt and braces: never credit a top-up that already has its ledger entry (a status that was lost after a credit).
  IF NOT EXISTS (
    SELECT 1 FROM ledger_entries l
     WHERE l.wallet_id = v_t.wallet_id AND l.reference = 'TOPUP-' || v_t.id AND l.entry_type = 'TOPUP'
  ) THEN
    PERFORM credit_wallet(v_t.wallet_id, v_t.amount_cents, 'TOPUP', 'TOPUP-' || v_t.id, v_t.currency,
      jsonb_build_object('wallet_topup_id', v_t.id, 'psp_intent_id', p_psp_intent_id));
  END IF;

  UPDATE wallet_topups SET status = 'SUCCESS', updated_at = NOW() WHERE id = v_t.id;
  RETURN QUERY SELECT TRUE, v_user, v_t.amount_cents, v_t.currency;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.complete_topup(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_topup(UUID, TEXT) TO service_role;
