-- ============================================================================
-- 007_wallet_phase2.sql — LinkPay Wallet, Phase 2
-- (PIN de transaction, transfert P2P, retrait, limites configurables)
-- Run once in the Supabase SQL editor, same as previous migrations.
--
-- Builds on 006_wallets.sql (wallets, wallet_topups, credit_wallet/
-- debit_wallet). Reuses the existing commission_rules/CommissionsService and
-- payment_requests/payment_intents/transactions pipeline for wallet-based
-- invoice payment instead of duplicating it (see PaymentsService.payWithWallet).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Transaction PIN — never stored in clear, only a bcrypt hash. Lockout after
-- repeated failures (5 attempts -> 15 min lock), enforced server-side.
-- ----------------------------------------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS transaction_pin_hash TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pin_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- New ledger entry types for transfers/withdrawals (TOPUP and the original
-- 6 values already exist from 001/006). PAYMENT and ADJUSTMENT are reused
-- for wallet invoice-payment debits and withdrawal restitution credits.
-- ----------------------------------------------------------------------------
ALTER TYPE ledger_entry_type ADD VALUE IF NOT EXISTS 'TRANSFER_OUT';
ALTER TYPE ledger_entry_type ADD VALUE IF NOT EXISTS 'TRANSFER_IN';
ALTER TYPE ledger_entry_type ADD VALUE IF NOT EXISTS 'WITHDRAWAL';

-- ----------------------------------------------------------------------------
-- transfers — user-to-user, by LinkPay number
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transfers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_wallet_id UUID NOT NULL REFERENCES wallets(id),
  recipient_wallet_id UUID NOT NULL REFERENCES wallets(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  fee_cents BIGINT NOT NULL DEFAULT 0,
  currency VARCHAR(10) DEFAULT 'CDF',
  status VARCHAR(20) DEFAULT 'PENDING', -- PENDING | SUCCESS | FAILED
  description TEXT,
  failure_reason TEXT,
  idempotency_key VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT transfers_not_to_self CHECK (sender_wallet_id <> recipient_wallet_id)
);
CREATE INDEX IF NOT EXISTS idx_transfers_sender ON transfers(sender_wallet_id);
CREATE INDEX IF NOT EXISTS idx_transfers_recipient ON transfers(recipient_wallet_id);

-- ----------------------------------------------------------------------------
-- withdrawals — wallet -> Mobile Money / bank (demo: mock settlement only,
-- no real payout PSP is integrated yet; see WalletsService.requestWithdrawal)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS withdrawals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  fee_cents BIGINT NOT NULL DEFAULT 0,
  currency VARCHAR(10) DEFAULT 'CDF',
  channel VARCHAR(30) NOT NULL, -- mobile_money | bank
  destination JSONB NOT NULL DEFAULT '{}'::jsonb, -- {operator, phone} or {bank, account_number, account_name}
  status VARCHAR(20) DEFAULT 'PENDING', -- PENDING|PROCESSING|SUCCESS|FAILED|CANCELLED|REVERSED
  psp_provider VARCHAR(50),
  psp_reference VARCHAR(255),
  failure_reason TEXT,
  idempotency_key VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_wallet_id ON withdrawals(wallet_id);

-- ----------------------------------------------------------------------------
-- wallet_limits — configurable per operation type, never hardcoded in the
-- frontend or in application code. One global row per op_type by default
-- (applies_to = 'all'); a future per-user override could add a row with
-- applies_to = 'user' + user_id, checked preferentially — not built yet,
-- kept simple for Phase 2.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallet_limits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  op_type VARCHAR(30) NOT NULL, -- TRANSFER | WITHDRAWAL | WALLET_PAYMENT
  applies_to VARCHAR(20) NOT NULL DEFAULT 'all',
  min_cents BIGINT NOT NULL DEFAULT 100,
  max_cents BIGINT, -- per-operation cap, NULL = no cap
  daily_max_cents BIGINT, -- NULL = no cap
  monthly_max_cents BIGINT, -- NULL = no cap
  fee_percent NUMERIC(6, 4) NOT NULL DEFAULT 0, -- e.g. 0.01 = 1%
  fee_fixed_cents BIGINT NOT NULL DEFAULT 0,
  currency VARCHAR(10) DEFAULT 'CDF',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (op_type, applies_to, currency)
);

-- Sane defaults for demo/dev — real values should be tuned by an admin
-- before any public launch, per KYC tier etc. (documented backlog item).
INSERT INTO wallet_limits (op_type, min_cents, max_cents, daily_max_cents, monthly_max_cents, fee_percent, fee_fixed_cents)
VALUES
  ('TRANSFER', 100, 500000000, 1000000000, 10000000000, 0, 0),
  ('WITHDRAWAL', 100, 500000000, 500000000, 5000000000, 0.01, 0),
  ('WALLET_PAYMENT', 100, 500000000, NULL, NULL, 0, 0)
ON CONFLICT (op_type, applies_to, currency) DO NOTHING;

-- ----------------------------------------------------------------------------
-- transfer_wallet — the ONLY sanctioned way to move money between two
-- wallets. Re-reads the already-created `transfers` PENDING row (created by
-- the backend right after the idempotency check, so a retry with the same
-- Idempotency-Key never re-executes this) and settles it atomically: locks
-- both wallets in a fixed order (by id) to prevent deadlocks between two
-- concurrent transfers going in opposite directions, verifies the sender's
-- real balance, writes both ledger entries, marks the transfer SUCCESS or
-- raises (caller marks it FAILED). SECURITY DEFINER + service_role-only,
-- same posture as credit_wallet/debit_wallet.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_wallet(p_transfer_id UUID)
RETURNS TABLE (sender_balance BIGINT, recipient_balance BIGINT)
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transfer RECORD;
  v_first UUID;
  v_second UUID;
  v_sender_balance BIGINT;
  v_sender_status VARCHAR;
  v_recipient_status VARCHAR;
BEGIN
  SELECT * INTO v_transfer FROM transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer % not found', p_transfer_id;
  END IF;
  IF v_transfer.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Transfer % is not PENDING (status: %)', p_transfer_id, v_transfer.status;
  END IF;

  -- Lock both wallets in a stable order regardless of who is sender/recipient
  -- (prevents deadlock against a concurrent transfer going the other way).
  IF v_transfer.sender_wallet_id < v_transfer.recipient_wallet_id THEN
    v_first := v_transfer.sender_wallet_id;
    v_second := v_transfer.recipient_wallet_id;
  ELSE
    v_first := v_transfer.recipient_wallet_id;
    v_second := v_transfer.sender_wallet_id;
  END IF;

  PERFORM 1 FROM wallets WHERE id = v_first FOR UPDATE;
  PERFORM 1 FROM wallets WHERE id = v_second FOR UPDATE;

  SELECT status INTO v_sender_status FROM wallets WHERE id = v_transfer.sender_wallet_id;
  SELECT status INTO v_recipient_status FROM wallets WHERE id = v_transfer.recipient_wallet_id;

  IF v_sender_status IS NULL OR v_recipient_status IS NULL THEN
    RAISE EXCEPTION 'Sender or recipient wallet not found';
  END IF;
  -- Note: none of the RAISE EXCEPTION calls below are preceded by an UPDATE
  -- marking the transfer FAILED — a raised exception rolls back everything
  -- this function has done so far, including such an UPDATE, since it all
  -- runs in the same transaction. Marking the row FAILED (with a reason) is
  -- done by the caller (WalletsService.transfer()) once the RPC call itself
  -- has failed, after this transaction has already been rolled back.
  IF v_sender_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'SENDER_WALLET_%', v_sender_status;
  END IF;
  IF v_recipient_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'RECIPIENT_WALLET_%', v_recipient_status;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END), 0)
    INTO v_sender_balance
    FROM ledger_entries WHERE wallet_id = v_transfer.sender_wallet_id;

  IF v_sender_balance < (v_transfer.amount_cents + v_transfer.fee_cents) THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE: has %, needs %', v_sender_balance, v_transfer.amount_cents + v_transfer.fee_cents;
  END IF;

  INSERT INTO ledger_entries (wallet_id, entry_type, direction, amount_cents, currency, reference, source, metadata)
  VALUES (
    v_transfer.sender_wallet_id, 'TRANSFER_OUT', 'debit', v_transfer.amount_cents + v_transfer.fee_cents,
    v_transfer.currency, 'TRANSFER-' || v_transfer.id, 'system',
    jsonb_build_object('transfer_id', v_transfer.id, 'counterparty_wallet_id', v_transfer.recipient_wallet_id)
  );

  INSERT INTO ledger_entries (wallet_id, entry_type, direction, amount_cents, currency, reference, source, metadata)
  VALUES (
    v_transfer.recipient_wallet_id, 'TRANSFER_IN', 'credit', v_transfer.amount_cents,
    v_transfer.currency, 'TRANSFER-' || v_transfer.id, 'system',
    jsonb_build_object('transfer_id', v_transfer.id, 'counterparty_wallet_id', v_transfer.sender_wallet_id)
  );

  UPDATE transfers SET status = 'SUCCESS', updated_at = NOW() WHERE id = p_transfer_id;

  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END), 0) INTO sender_balance
    FROM ledger_entries WHERE wallet_id = v_transfer.sender_wallet_id;
  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END), 0) INTO recipient_balance
    FROM ledger_entries WHERE wallet_id = v_transfer.recipient_wallet_id;

  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.transfer_wallet(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_wallet(UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
ALTER TABLE transfers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS transfers_select_own ON transfers;
CREATE POLICY transfers_select_own ON transfers FOR SELECT USING (
  auth.uid() IN (SELECT user_id FROM wallets WHERE id IN (transfers.sender_wallet_id, transfers.recipient_wallet_id))
  OR public.is_admin()
);

ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS withdrawals_select_own ON withdrawals;
CREATE POLICY withdrawals_select_own ON withdrawals FOR SELECT USING (
  auth.uid() IN (SELECT user_id FROM wallets WHERE id = withdrawals.wallet_id) OR public.is_admin()
);

ALTER TABLE wallet_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wallet_limits_admin_only ON wallet_limits;
CREATE POLICY wallet_limits_admin_only ON wallet_limits FOR SELECT USING (public.is_admin());

-- ----------------------------------------------------------------------------
-- Realtime
-- ----------------------------------------------------------------------------
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE transfers; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE withdrawals; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
