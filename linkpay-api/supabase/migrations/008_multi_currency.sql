-- ============================================================================
-- 008_multi_currency.sql — LinkPay Multi-Currency (CDF/FC + USD)
-- Run once in the Supabase SQL editor, same as previous migrations.
--
-- Every currency balance is fully independent — NO automatic conversion
-- anywhere in this system. An operation in USD only ever checks/moves the
-- USD balance; same for CDF. No exchange-rate infrastructure is introduced
-- here (none existed before this migration either).
--
-- No new "wallet_balances" table: ledger_entries already carries its own
-- `currency` per row, so a wallet's balance-per-currency is just that same
-- SUM query with an added `AND currency = ...` filter (see the RPC changes
-- and WalletsService.getBalances() below).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- merchants: a default currency for new payment links (still overridable per
-- link at creation time).
-- ----------------------------------------------------------------------------
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS default_currency VARCHAR(10) NOT NULL DEFAULT 'CDF';

-- ----------------------------------------------------------------------------
-- CHECK constraints (not a Postgres ENUM — see plan notes: 11 existing
-- VARCHAR(10) currency columns across the schema, converting them all to a
-- shared enum type is a high-risk single-shot ALTER COLUMN ... TYPE ... USING
-- with no rollback safety net in this hand-run-migration setup. A CHECK
-- constraint gives the same guarantee, additively, per table.
-- ----------------------------------------------------------------------------
ALTER TABLE merchants ADD CONSTRAINT merchants_default_currency_check CHECK (default_currency IN ('CDF','USD'));
ALTER TABLE wallets ADD CONSTRAINT wallets_currency_check CHECK (currency IN ('CDF','USD'));
ALTER TABLE wallet_topups ADD CONSTRAINT wallet_topups_currency_check CHECK (currency IN ('CDF','USD'));
ALTER TABLE transfers ADD CONSTRAINT transfers_currency_check CHECK (currency IN ('CDF','USD'));
ALTER TABLE withdrawals ADD CONSTRAINT withdrawals_currency_check CHECK (currency IN ('CDF','USD'));
ALTER TABLE wallet_limits ADD CONSTRAINT wallet_limits_currency_check CHECK (currency IN ('CDF','USD'));
ALTER TABLE commission_rules ADD CONSTRAINT commission_rules_currency_check CHECK (currency IN ('CDF','USD'));
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_currency_check CHECK (currency IN ('CDF','USD'));
ALTER TABLE payment_intents ADD CONSTRAINT payment_intents_currency_check CHECK (currency IN ('CDF','USD'));
ALTER TABLE settlements ADD CONSTRAINT settlements_currency_check CHECK (currency IN ('CDF','USD'));

-- Larger/hotter tables: validate without holding a long lock on every row up front.
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_currency_check CHECK (currency IN ('CDF','USD')) NOT VALID;
ALTER TABLE ledger_entries VALIDATE CONSTRAINT ledger_entries_currency_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_currency_check CHECK (currency IN ('CDF','USD')) NOT VALID;
ALTER TABLE transactions VALIDATE CONSTRAINT transactions_currency_check;

-- Supports the new per-(wallet, currency) balance queries.
CREATE INDEX IF NOT EXISTS idx_ledger_entries_wallet_currency ON ledger_entries(wallet_id, currency);

-- ----------------------------------------------------------------------------
-- credit_wallet / debit_wallet — must be dropped first: CREATE OR REPLACE
-- FUNCTION does NOT replace a function when the argument list changes, it
-- creates an ambiguous second overload instead. Both now take an explicit
-- p_currency and only ever look at ledger_entries in that currency.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.credit_wallet(UUID, BIGINT, ledger_entry_type, VARCHAR, JSONB);
DROP FUNCTION IF EXISTS public.debit_wallet(UUID, BIGINT, ledger_entry_type, VARCHAR, JSONB);

CREATE OR REPLACE FUNCTION public.credit_wallet(
  p_wallet_id UUID,
  p_amount_cents BIGINT,
  p_entry_type ledger_entry_type,
  p_reference VARCHAR,
  p_currency VARCHAR,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS BIGINT
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance BIGINT;
BEGIN
  IF p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'amount_cents must be positive';
  END IF;
  IF p_currency NOT IN ('CDF', 'USD') THEN
    RAISE EXCEPTION 'INVALID_CURRENCY: %', p_currency;
  END IF;

  PERFORM 1 FROM wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet % not found', p_wallet_id;
  END IF;

  INSERT INTO ledger_entries (wallet_id, entry_type, direction, amount_cents, currency, reference, source, metadata)
  VALUES (p_wallet_id, p_entry_type, 'credit', p_amount_cents, p_currency, p_reference, 'system', p_metadata);

  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END), 0)
    INTO v_balance
    FROM ledger_entries WHERE wallet_id = p_wallet_id AND currency = p_currency;

  RETURN v_balance;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.debit_wallet(
  p_wallet_id UUID,
  p_amount_cents BIGINT,
  p_entry_type ledger_entry_type,
  p_reference VARCHAR,
  p_currency VARCHAR,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS BIGINT
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance BIGINT;
BEGIN
  IF p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'amount_cents must be positive';
  END IF;
  IF p_currency NOT IN ('CDF', 'USD') THEN
    RAISE EXCEPTION 'INVALID_CURRENCY: %', p_currency;
  END IF;

  PERFORM 1 FROM wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet % not found', p_wallet_id;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END), 0)
    INTO v_balance
    FROM ledger_entries WHERE wallet_id = p_wallet_id AND currency = p_currency;

  IF v_balance < p_amount_cents THEN
    RAISE EXCEPTION 'Insufficient balance: has %, needs % (currency %)', v_balance, p_amount_cents, p_currency;
  END IF;

  INSERT INTO ledger_entries (wallet_id, entry_type, direction, amount_cents, currency, reference, source, metadata)
  VALUES (p_wallet_id, p_entry_type, 'debit', p_amount_cents, p_currency, p_reference, 'system', p_metadata);

  RETURN v_balance - p_amount_cents;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.credit_wallet(UUID, BIGINT, ledger_entry_type, VARCHAR, VARCHAR, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.debit_wallet(UUID, BIGINT, ledger_entry_type, VARCHAR, VARCHAR, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.credit_wallet(UUID, BIGINT, ledger_entry_type, VARCHAR, VARCHAR, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.debit_wallet(UUID, BIGINT, ledger_entry_type, VARCHAR, VARCHAR, JSONB) TO service_role;

-- ----------------------------------------------------------------------------
-- transfer_wallet — signature unchanged (currency already lives on the
-- transfers row itself), but its 3 internal balance queries previously
-- summed ALL currencies for a wallet together. Fixed to filter by the
-- transfer's own currency.
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
  IF v_transfer.currency NOT IN ('CDF', 'USD') THEN
    RAISE EXCEPTION 'INVALID_CURRENCY: %', v_transfer.currency;
  END IF;

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
  IF v_sender_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'SENDER_WALLET_%', v_sender_status;
  END IF;
  IF v_recipient_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'RECIPIENT_WALLET_%', v_recipient_status;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END), 0)
    INTO v_sender_balance
    FROM ledger_entries WHERE wallet_id = v_transfer.sender_wallet_id AND currency = v_transfer.currency;

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
    FROM ledger_entries WHERE wallet_id = v_transfer.sender_wallet_id AND currency = v_transfer.currency;
  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END), 0) INTO recipient_balance
    FROM ledger_entries WHERE wallet_id = v_transfer.recipient_wallet_id AND currency = v_transfer.currency;

  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- wallet_limits: USD row per op_type, independent demo numbers (NOT derived
-- from any exchange rate — none exists). Mirrors each CDF row's fee shape.
-- ----------------------------------------------------------------------------
INSERT INTO wallet_limits (op_type, currency, min_cents, max_cents, daily_max_cents, monthly_max_cents, fee_percent, fee_fixed_cents)
VALUES
  ('TRANSFER', 'USD', 100, 200000, 500000, 5000000, 0, 0),
  ('WITHDRAWAL', 'USD', 100, 200000, 200000, 2000000, 0.01, 0),
  ('WALLET_PAYMENT', 'USD', 100, 200000, NULL, NULL, 0, 0)
ON CONFLICT (op_type, applies_to, currency) DO NOTHING;

-- ----------------------------------------------------------------------------
-- commission_rules: one global USD rule, mirroring the existing CDF one's
-- shape with independent USD-appropriate bounds on the commission itself.
-- ----------------------------------------------------------------------------
INSERT INTO commission_rules (name, description, percent, fixed_cents, min_cents, max_cents, applies_to, currency, version, is_active, valid_from)
SELECT 'Standard USD 2.5%', 'Règle globale par défaut (USD)', '0.0250', 0, 5, 10000, 'all', 'USD', 1, TRUE, NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM commission_rules WHERE applies_to = 'all' AND currency = 'USD' AND is_active = TRUE
);
