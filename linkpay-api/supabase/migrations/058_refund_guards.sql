-- ============================================================================
-- 058_refund_guards.sql — refunds respect frozen wallets and unpaid transactions.
--
-- refund_to_client_wallet() (041) did not look at wallet status: a FROZEN or SUSPENDED merchant wallet could still be
-- drained to a client wallet by a refund. And a refund requested before the merchant's net had been credited turned
-- the transaction into REFUNDED, after which credit_merchant_wallet() refuses it — the merchant was never paid.
-- Both are now refused (REFUND_WALLET_NOT_ACTIVE, REFUND_TX_NOT_CREDITED).
--
-- API only. Run once in the Supabase SQL editor (after 057).
-- ============================================================================

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

  -- The merchant's net must have reached their wallet first. Refunding before that would flip the transaction to
  -- REFUNDED, and credit_merchant_wallet() refuses a refunded transaction: the merchant would never be paid.
  IF v_tx.wallet_credited_at IS NULL THEN
    RAISE EXCEPTION 'REFUND_TX_NOT_CREDITED';
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

  -- A frozen or suspended wallet is frozen for a reason: money must not leave it (or enter it) through a refund.
  IF EXISTS (SELECT 1 FROM wallets WHERE id IN (v_merchant_wallet, v_client_wallet) AND status <> 'ACTIVE') THEN
    RAISE EXCEPTION 'REFUND_WALLET_NOT_ACTIVE';
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

REVOKE ALL ON FUNCTION public.refund_to_client_wallet(UUID, BIGINT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_to_client_wallet(UUID, BIGINT, TEXT, UUID) TO service_role;
