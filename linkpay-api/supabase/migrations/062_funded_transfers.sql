-- ============================================================================
-- 062_funded_transfers.sql — Person-to-person transfers funded by the PSP
-- (Mobile Money / card), not by the sender's wallet balance.
--
-- Run once in the Supabase SQL editor, same as previous migrations.
--
-- Why a separate completion path: transfer_wallet() (007) debits the sender's
-- wallet. A PSP-funded transfer never touches the sender's wallet — the money
-- comes in from outside (FlexPaie), so settling it only credits the recipient.
-- Like complete_topup() (056), complete_funded_transfer() claims PENDING ->
-- SUCCESS under a row lock, so a webhook delivered twice, or racing the
-- status-check endpoint, credits the recipient exactly once.
-- ============================================================================

-- Which provider funded the transfer, and the reference it knows it by
-- (used by the webhook dispatcher, the status check and the reconciliation
-- sweep — all look a funded transfer up by psp_intent_id).
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS psp_provider VARCHAR(50);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS psp_intent_id VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transfers_psp_intent
  ON transfers(psp_intent_id) WHERE psp_intent_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- complete_funded_transfer — settles a PSP-funded P2P transfer in ONE
-- transaction: claims PENDING -> SUCCESS, credits the recipient, returns the
-- parties so the caller can notify them. Never debits the sender's wallet
-- (the PSP already collected amount + fee from the sender's Mobile Money /
-- card — the platform fee stays in the PSP float, recorded as fee_cents).
-- SECURITY DEFINER + service_role-only, same posture as the other money RPCs.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_funded_transfer(p_transfer_id UUID, p_psp_intent_id TEXT DEFAULT NULL)
RETURNS TABLE (credited BOOLEAN, sender_user_id UUID, recipient_user_id UUID, amount_cents BIGINT, currency VARCHAR)
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transfer RECORD;
  v_recipient_status VARCHAR;
  v_sender_user UUID;
  v_recipient_user UUID;
BEGIN
  SELECT * INTO v_transfer FROM transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FUNDED_TRANSFER_NOT_FOUND: %', p_transfer_id;
  END IF;
  IF v_transfer.status <> 'PENDING' THEN
    -- Someone else already settled (or failed) it — safe no-op, never a double credit.
    credited := FALSE;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT status INTO v_recipient_status FROM wallets WHERE id = v_transfer.recipient_wallet_id;
  IF v_recipient_status IS NULL OR v_recipient_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'RECIPIENT_WALLET_%', COALESCE(v_recipient_status, 'NOT_FOUND');
  END IF;

  INSERT INTO ledger_entries (wallet_id, entry_type, direction, amount_cents, currency, reference, source, metadata)
  VALUES (
    v_transfer.recipient_wallet_id, 'TRANSFER_IN', 'credit', v_transfer.amount_cents,
    v_transfer.currency, 'TRANSFER-' || v_transfer.id, 'system',
    jsonb_build_object('transfer_id', v_transfer.id, 'counterparty_wallet_id', v_transfer.sender_wallet_id, 'funded_by', COALESCE(v_transfer.psp_provider, 'psp'))
  );

  UPDATE transfers
    SET status = 'SUCCESS',
        psp_intent_id = COALESCE(p_psp_intent_id, psp_intent_id),
        updated_at = NOW()
    WHERE id = p_transfer_id;

  SELECT user_id INTO v_sender_user FROM wallets WHERE id = v_transfer.sender_wallet_id;
  SELECT user_id INTO v_recipient_user FROM wallets WHERE id = v_transfer.recipient_wallet_id;

  credited := TRUE;
  sender_user_id := v_sender_user;
  recipient_user_id := v_recipient_user;
  amount_cents := v_transfer.amount_cents;
  currency := v_transfer.currency;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.complete_funded_transfer(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_funded_transfer(UUID, TEXT) TO service_role;
