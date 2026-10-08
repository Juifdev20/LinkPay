-- ============================================================================
-- 040_settlement_and_refund_integrity.sql — Payout account + race-free
-- settlements and refunds.
--
-- 1. merchants.settlement_account: where the platform sends a merchant's
--    money ({method, operator, number, holder_name, ...}). The API already
--    listed this field as updatable, but the column never existed, so an
--    admin processing a settlement had no way to know where to pay.
--    settlements.payout_account snapshots it at request time, so a later
--    edit never changes where an already-requested payout goes.
--
-- 2. create_merchant_settlements(): the API used to read the unsettled
--    transactions, insert the settlement, then tag the transactions — two
--    concurrent requests (a double tap) could both read the same rows and
--    produce two settlements paying the same money twice. The function locks
--    the merchant row (serializing requests per merchant) and the
--    transaction rows, and only claims rows still unsettled.
--    It also settles PARTIALLY_REFUNDED transactions (net minus what was
--    refunded) and skips any transaction with a refund still in flight.
--
-- 3. reserve_refund(): the "already refunded + this refund <= amount" check
--    was a read-then-insert in the API, so two concurrent refunds could both
--    pass it. The function locks the transaction row, re-checks under the
--    lock, refuses a transaction already included in a settlement (the
--    merchant has been, or is about to be, paid that money), and inserts the
--    refund as PENDING before the PSP is called.
--
-- 4. fail_settlement(): marking a settlement FAILED used to leave its
--    transactions tagged with it forever — the merchant could never request
--    that money again. The function releases them and reverses the ledger
--    entry.
--
-- Only the API (service_role) may call these, like credit_wallet (006).
-- Run once in the Supabase SQL editor, same as previous migrations — BEFORE
-- deploying the API version that calls these functions.
-- ============================================================================

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS settlement_account JSONB;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS payout_account JSONB;

CREATE INDEX IF NOT EXISTS idx_transactions_merchant_unsettled
  ON transactions(merchant_id) WHERE settlement_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_refunds_transaction_id ON refunds(transaction_id);

-- ----------------------------------------------------------------------------
-- create_merchant_settlements
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_merchant_settlements(
  p_merchant_id UUID,
  p_payout_account JSONB
) RETURNS SETOF settlements
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_currency VARCHAR;
  v_settlement settlements;
  v_period_start TIMESTAMPTZ;
  v_period_end TIMESTAMPTZ := NOW();
BEGIN
  -- Serializes settlement requests for this merchant: a second concurrent
  -- call waits here, then finds every transaction already claimed.
  PERFORM 1 FROM merchants WHERE id = p_merchant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Merchant % not found', p_merchant_id;
  END IF;

  CREATE TEMP TABLE _settleable ON COMMIT DROP AS
  SELECT t.id,
         COALESCE(t.currency, 'CDF') AS currency,
         t.amount_cents,
         COALESCE(t.psp_fee_cents, 0) AS psp_fee_cents,
         COALESCE(t.platform_fee_cents, 0) AS platform_fee_cents,
         GREATEST(
           COALESCE(t.net_cents, 0) - COALESCE((
             SELECT SUM(r.amount_cents) FROM refunds r
              WHERE r.transaction_id = t.id AND r.status = 'COMPLETED'
           ), 0),
           0
         ) AS net_cents,
         t.created_at
    FROM transactions t
   WHERE t.merchant_id = p_merchant_id
     AND t.status IN ('SUCCESS', 'PARTIALLY_REFUNDED')
     AND t.settlement_id IS NULL
     -- A refund still waiting on the PSP could yet complete: settle that
     -- transaction next time, once its refunded amount is known.
     AND NOT EXISTS (
       SELECT 1 FROM refunds r WHERE r.transaction_id = t.id AND r.status = 'PENDING'
     )
   FOR UPDATE OF t;

  FOR v_currency IN SELECT DISTINCT currency FROM _settleable LOOP
    SELECT MIN(created_at) INTO v_period_start FROM _settleable WHERE currency = v_currency;

    INSERT INTO settlements (
      merchant_id, period_start, period_end, gross_cents, psp_fees_cents,
      platform_fees_cents, net_cents, currency, status, reference,
      transaction_count, payout_account
    )
    SELECT p_merchant_id, v_period_start, v_period_end,
           SUM(amount_cents), SUM(psp_fee_cents), SUM(platform_fee_cents),
           SUM(net_cents), v_currency, 'PENDING',
           'STL-' || to_char(v_period_end, 'YYYYMMDD') || '-' || upper(substr(md5(random()::text), 1, 6)),
           COUNT(*), p_payout_account
      FROM _settleable WHERE currency = v_currency
    RETURNING * INTO v_settlement;

    UPDATE transactions SET settlement_id = v_settlement.id, updated_at = NOW()
     WHERE id IN (SELECT id FROM _settleable WHERE currency = v_currency);

    INSERT INTO ledger_entries (settlement_id, entry_type, direction, amount_cents, currency, reference, source, metadata)
    VALUES (v_settlement.id, 'SETTLEMENT', 'debit', v_settlement.net_cents, v_currency,
            v_settlement.reference, 'system', jsonb_build_object('merchant_id', p_merchant_id));

    RETURN NEXT v_settlement;
  END LOOP;

  RETURN;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- fail_settlement
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fail_settlement(
  p_settlement_id UUID,
  p_notes TEXT DEFAULT NULL
) RETURNS settlements
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settlement settlements;
BEGIN
  UPDATE settlements
     SET status = 'FAILED',
         notes = COALESCE(p_notes, notes),
         updated_at = NOW()
   WHERE id = p_settlement_id AND status IN ('PENDING', 'PROCESSING')
  RETURNING * INTO v_settlement;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Settlement % not found or not in a failable state', p_settlement_id;
  END IF;

  -- Give the money back to the merchant's available balance.
  UPDATE transactions SET settlement_id = NULL, updated_at = NOW()
   WHERE settlement_id = p_settlement_id;

  INSERT INTO ledger_entries (settlement_id, entry_type, direction, amount_cents, currency, reference, source, metadata)
  VALUES (p_settlement_id, 'SETTLEMENT', 'credit', v_settlement.net_cents, v_settlement.currency,
          v_settlement.reference, 'system',
          jsonb_build_object('merchant_id', v_settlement.merchant_id, 'reason', 'settlement_failed'));

  RETURN v_settlement;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- reserve_refund
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_refund(
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
  v_already BIGINT;
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

  IF v_tx.settlement_id IS NOT NULL THEN
    RAISE EXCEPTION 'REFUND_TX_SETTLED';
  END IF;

  SELECT COALESCE(SUM(amount_cents), 0) INTO v_already
    FROM refunds
   WHERE transaction_id = p_transaction_id AND status IN ('PENDING', 'COMPLETED');

  IF v_already + p_amount_cents > v_tx.amount_cents THEN
    RAISE EXCEPTION 'REFUND_EXCEEDS_AMOUNT';
  END IF;

  INSERT INTO refunds (transaction_id, amount_cents, currency, reason, status, processed_by)
  VALUES (p_transaction_id, p_amount_cents, v_tx.currency, p_reason, 'PENDING', p_processed_by)
  RETURNING * INTO v_refund;

  RETURN v_refund;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.create_merchant_settlements(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_settlement(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_refund(UUID, BIGINT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_merchant_settlements(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_settlement(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_refund(UUID, BIGINT, TEXT, UUID) TO service_role;
