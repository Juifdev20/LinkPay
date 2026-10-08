-- ============================================================================
-- 041_automatic_merchant_payouts.sql — Merchants are paid straight into their
-- ScanLinkPay wallet; refunds come out of that wallet.
--
-- Until now a merchant's share of each sale sat in a "settlement balance"
-- that had to be requested by hand and paid out manually by an admin. Now,
-- the moment a payment succeeds:
--   net = amount - PSP fee - platform commission (the rule the super_admin
--   configures) is credited to the wallet of the merchant's OWNER — for an
--   enterprise store that is the owner of the enterprise.
--
-- 1. credit_merchant_wallet(transaction_id): credits that net amount exactly
--    once. Locks the transaction and stamps wallet_credited_at, so a webhook
--    arriving twice, or the retry job below, can never credit it twice.
--
-- 2. refund_to_client_wallet(...): a refund is paid out of the merchant's
--    wallet into the paying client's wallet, in one database transaction.
--    It is refused when the merchant's wallet doesn't hold enough (they
--    refund in cash instead — or top up first), and when the payer has no
--    ScanLinkPay account (CinetPay has no refund API, so there is nowhere to
--    send the money). The balance can therefore never go negative.
--
-- 3. The manual "request a settlement" flow is switched off (execute right
--    revoked below). Existing settlements stay readable for the admin.
--
-- Run once in the Supabase SQL editor, same as previous migrations — BEFORE
-- deploying the API version that calls these functions.
-- ============================================================================

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS wallet_credited_at TIMESTAMPTZ;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS credited_wallet_id UUID REFERENCES wallets(id);

-- Transactions already included in a settlement were paid out the old way:
-- mark them so the retry job doesn't credit them a second time. Any other
-- existing transaction is still owed to its merchant and gets credited by
-- the retry job.
UPDATE transactions SET wallet_credited_at = NOW() WHERE settlement_id IS NOT NULL AND wallet_credited_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_wallet_uncredited
  ON transactions(created_at) WHERE wallet_credited_at IS NULL AND status IN ('SUCCESS', 'PARTIALLY_REFUNDED');

-- ----------------------------------------------------------------------------
-- credit_merchant_wallet
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.credit_merchant_wallet(p_transaction_id UUID)
RETURNS BIGINT
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx transactions;
  v_owner UUID;
  v_wallet UUID;
  v_balance BIGINT;
BEGIN
  SELECT * INTO v_tx FROM transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TX_NOT_FOUND';
  END IF;

  -- Already credited: nothing to do (this is what makes retries safe).
  IF v_tx.wallet_credited_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  IF v_tx.status NOT IN ('SUCCESS', 'PARTIALLY_REFUNDED') THEN
    RAISE EXCEPTION 'TX_NOT_SUCCESSFUL';
  END IF;

  SELECT owner_id INTO v_owner FROM merchants WHERE id = v_tx.merchant_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'MERCHANT_NOT_FOUND';
  END IF;

  -- One wallet per user; the owner may not have opened theirs yet.
  SELECT id INTO v_wallet FROM wallets WHERE user_id = v_owner;
  IF v_wallet IS NULL THEN
    INSERT INTO wallets (user_id, wallet_number)
    VALUES (v_owner, generate_wallet_number(v_owner))
    ON CONFLICT (user_id) DO NOTHING;
    SELECT id INTO v_wallet FROM wallets WHERE user_id = v_owner;
  END IF;

  IF COALESCE(v_tx.net_cents, 0) > 0 THEN
    v_balance := credit_wallet(
      v_wallet, v_tx.net_cents, 'PAYMENT', 'PAYMENT-' || v_tx.reference, v_tx.currency,
      jsonb_build_object('transaction_id', v_tx.id, 'merchant_id', v_tx.merchant_id)
    );
  END IF;

  UPDATE transactions
     SET wallet_credited_at = NOW(), credited_wallet_id = v_wallet, updated_at = NOW()
   WHERE id = p_transaction_id;

  RETURN v_balance;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- refund_to_client_wallet
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_to_client_wallet(
  p_transaction_id UUID,
  p_amount_cents BIGINT,
  p_reason TEXT,
  p_processed_by UUID
) RETURNS refunds
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx transactions;
  v_owner UUID;
  v_merchant_wallet UUID;
  v_client_wallet UUID;
  v_already BIGINT;
  v_balance BIGINT;
  v_total_refunded BIGINT;
  v_refund refunds;
BEGIN
  IF p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'REFUND_INVALID_AMOUNT';
  END IF;

  SELECT * INTO v_tx FROM transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REFUND_TX_NOT_FOUND';
  END IF;

  IF v_tx.status NOT IN ('SUCCESS', 'PARTIALLY_REFUNDED') THEN
    RAISE EXCEPTION 'REFUND_TX_NOT_REFUNDABLE';
  END IF;

  -- Paid out the old way (manual settlement): the money already left the
  -- platform for the merchant, so it can't be clawed back from a wallet.
  IF v_tx.settlement_id IS NOT NULL THEN
    RAISE EXCEPTION 'REFUND_TX_SETTLED';
  END IF;

  IF v_tx.client_id IS NULL THEN
    RAISE EXCEPTION 'REFUND_NO_CLIENT_ACCOUNT';
  END IF;

  SELECT COALESCE(SUM(amount_cents), 0) INTO v_already
    FROM refunds WHERE transaction_id = p_transaction_id AND status IN ('PENDING', 'COMPLETED');
  IF v_already + p_amount_cents > v_tx.amount_cents THEN
    RAISE EXCEPTION 'REFUND_EXCEEDS_AMOUNT';
  END IF;

  SELECT owner_id INTO v_owner FROM merchants WHERE id = v_tx.merchant_id;
  SELECT id INTO v_merchant_wallet FROM wallets WHERE user_id = v_owner;
  SELECT id INTO v_client_wallet FROM wallets WHERE user_id = v_tx.client_id;

  IF v_client_wallet IS NULL THEN
    RAISE EXCEPTION 'REFUND_NO_CLIENT_ACCOUNT';
  END IF;
  IF v_merchant_wallet IS NULL THEN
    RAISE EXCEPTION 'REFUND_INSUFFICIENT_BALANCE:0:%', p_amount_cents;
  END IF;

  -- Always lock the two wallets in the same order, or two refunds going in
  -- opposite directions could deadlock each other.
  PERFORM 1 FROM wallets WHERE id IN (v_merchant_wallet, v_client_wallet) ORDER BY id FOR UPDATE;

  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END), 0)
    INTO v_balance
    FROM ledger_entries WHERE wallet_id = v_merchant_wallet AND currency = v_tx.currency;

  IF v_balance < p_amount_cents THEN
    RAISE EXCEPTION 'REFUND_INSUFFICIENT_BALANCE:%:%', v_balance, p_amount_cents;
  END IF;

  INSERT INTO refunds (transaction_id, amount_cents, currency, reason, status, processed_by)
  VALUES (p_transaction_id, p_amount_cents, v_tx.currency, p_reason, 'COMPLETED', p_processed_by)
  RETURNING * INTO v_refund;

  PERFORM debit_wallet(v_merchant_wallet, p_amount_cents, 'REFUND', 'REFUND-' || v_refund.id, v_tx.currency,
    jsonb_build_object('refund_id', v_refund.id, 'transaction_id', v_tx.id, 'direction', 'refund_given'));
  PERFORM credit_wallet(v_client_wallet, p_amount_cents, 'REFUND', 'REFUND-' || v_refund.id, v_tx.currency,
    jsonb_build_object('refund_id', v_refund.id, 'transaction_id', v_tx.id, 'direction', 'refund_received'));

  INSERT INTO ledger_entries (transaction_id, entry_type, direction, amount_cents, currency, reference, source, metadata)
  VALUES (v_tx.id, 'REFUND', 'debit', p_amount_cents, v_tx.currency, v_tx.reference, 'system',
          jsonb_build_object('refund_id', v_refund.id));

  SELECT COALESCE(SUM(amount_cents), 0) INTO v_total_refunded
    FROM refunds WHERE transaction_id = p_transaction_id AND status = 'COMPLETED';

  UPDATE transactions
     SET status = CASE WHEN v_total_refunded >= v_tx.amount_cents THEN 'REFUNDED' ELSE 'PARTIALLY_REFUNDED' END::transaction_status,
         updated_at = NOW()
   WHERE id = p_transaction_id;

  RETURN v_refund;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.credit_merchant_wallet(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refund_to_client_wallet(UUID, BIGINT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.credit_merchant_wallet(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_to_client_wallet(UUID, BIGINT, TEXT, UUID) TO service_role;

-- Manual settlement requests are gone: nobody should be able to claim the
-- same money a second time through the old function.
REVOKE EXECUTE ON FUNCTION public.create_merchant_settlements(UUID, JSONB) FROM service_role;
