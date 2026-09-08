-- ============================================================================
-- 006_wallets.sql — LinkPay Wallet, Phase 1 (compte + numéro + recharge)
-- Run once in the Supabase SQL editor (or `supabase db push`), same as
-- previous migrations.
--
-- IMPORTANT — regulatory note: a rechargeable balance makes LinkPay an
-- e-money issuer in DRC, which normally requires a Banque Centrale du Congo
-- license or a partnership with an already-licensed institution. This
-- migration builds the technical architecture for development/demo purposes
-- only — it does not itself make the platform compliant for public launch.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- wallets
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS wallet_client_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS wallet_merchant_number_seq START 1;

CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_number VARCHAR(20) UNIQUE NOT NULL,
  currency VARCHAR(10) DEFAULT 'CDF',
  status VARCHAR(20) DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Server-generated, atomic (sequence-backed), format:
--   LP-00001234      for regular accounts
--   LP-MER-000458     for accounts that own a merchant
CREATE OR REPLACE FUNCTION public.generate_wallet_number(p_user_id UUID)
RETURNS VARCHAR AS $$
DECLARE
  v_is_merchant BOOLEAN;
  v_seq BIGINT;
BEGIN
  SELECT EXISTS(SELECT 1 FROM merchants WHERE owner_id = p_user_id) INTO v_is_merchant;
  IF v_is_merchant THEN
    v_seq := nextval('wallet_merchant_number_seq');
    RETURN 'LP-MER-' || lpad(v_seq::text, 6, '0');
  ELSE
    v_seq := nextval('wallet_client_number_seq');
    RETURN 'LP-' || lpad(v_seq::text, 8, '0');
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.set_wallet_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.wallet_number IS NULL THEN
    NEW.wallet_number := public.generate_wallet_number(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_wallet_number ON wallets;
CREATE TRIGGER trg_set_wallet_number
  BEFORE INSERT ON wallets
  FOR EACH ROW
  EXECUTE FUNCTION public.set_wallet_number();

-- ----------------------------------------------------------------------------
-- ledger_entries: generalize to also hold wallet-scoped entries
-- ----------------------------------------------------------------------------
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS wallet_id UUID REFERENCES wallets(id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_wallet_id ON ledger_entries(wallet_id);

ALTER TYPE ledger_entry_type ADD VALUE IF NOT EXISTS 'TOPUP';

-- ----------------------------------------------------------------------------
-- wallet_topups — same proven shape as payment_intents
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallet_topups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency VARCHAR(10) DEFAULT 'CDF',
  status VARCHAR(20) DEFAULT 'PENDING',
  psp_provider VARCHAR(50),
  psp_intent_id VARCHAR(255),
  idempotency_key VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_topups_wallet_id ON wallet_topups(wallet_id);

-- ----------------------------------------------------------------------------
-- credit_wallet / debit_wallet — the ONLY sanctioned way to move a wallet's
-- balance. Runs atomically inside Postgres (a single function call is one
-- transaction); FOR UPDATE row-locks the wallet so concurrent calls on the
-- same wallet serialize instead of racing past a stale balance read.
-- Not granted to anon/authenticated — only the backend's service_role key
-- may call these (see REVOKE/GRANT below).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.credit_wallet(
  p_wallet_id UUID,
  p_amount_cents BIGINT,
  p_entry_type ledger_entry_type,
  p_reference VARCHAR,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS BIGINT
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_currency VARCHAR;
  v_balance BIGINT;
BEGIN
  IF p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'amount_cents must be positive';
  END IF;

  SELECT currency INTO v_currency FROM wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet % not found', p_wallet_id;
  END IF;

  INSERT INTO ledger_entries (wallet_id, entry_type, direction, amount_cents, currency, reference, source, metadata)
  VALUES (p_wallet_id, p_entry_type, 'credit', p_amount_cents, v_currency, p_reference, 'system', p_metadata);

  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END), 0)
    INTO v_balance
    FROM ledger_entries WHERE wallet_id = p_wallet_id;

  RETURN v_balance;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.debit_wallet(
  p_wallet_id UUID,
  p_amount_cents BIGINT,
  p_entry_type ledger_entry_type,
  p_reference VARCHAR,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS BIGINT
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_currency VARCHAR;
  v_balance BIGINT;
BEGIN
  IF p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'amount_cents must be positive';
  END IF;

  SELECT currency INTO v_currency FROM wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet % not found', p_wallet_id;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END), 0)
    INTO v_balance
    FROM ledger_entries WHERE wallet_id = p_wallet_id;

  IF v_balance < p_amount_cents THEN
    RAISE EXCEPTION 'Insufficient balance: has %, needs %', v_balance, p_amount_cents;
  END IF;

  INSERT INTO ledger_entries (wallet_id, entry_type, direction, amount_cents, currency, reference, source, metadata)
  VALUES (p_wallet_id, p_entry_type, 'debit', p_amount_cents, v_currency, p_reference, 'system', p_metadata);

  RETURN v_balance - p_amount_cents;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.credit_wallet(UUID, BIGINT, ledger_entry_type, VARCHAR, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.debit_wallet(UUID, BIGINT, ledger_entry_type, VARCHAR, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.credit_wallet(UUID, BIGINT, ledger_entry_type, VARCHAR, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.debit_wallet(UUID, BIGINT, ledger_entry_type, VARCHAR, JSONB) TO service_role;

-- ----------------------------------------------------------------------------
-- Backfill: give every existing non-admin account a wallet
-- ----------------------------------------------------------------------------
INSERT INTO wallets (user_id)
SELECT p.id
FROM profiles p
LEFT JOIN wallets w ON w.user_id = p.id
WHERE w.id IS NULL
  AND p.id NOT IN (
    SELECT ur.user_id FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE r.slug IN ('admin', 'super_admin')
  );

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wallets_select_own ON wallets;
CREATE POLICY wallets_select_own ON wallets FOR SELECT USING (
  auth.uid() = user_id OR public.is_admin()
);

ALTER TABLE wallet_topups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wallet_topups_select_own ON wallet_topups;
CREATE POLICY wallet_topups_select_own ON wallet_topups FOR SELECT USING (
  auth.uid() IN (SELECT user_id FROM wallets WHERE id = wallet_topups.wallet_id) OR public.is_admin()
);

-- Additive policy — the pre-existing ledger_entries_admin_only policy stays;
-- Postgres OR-combines permissive policies, so this only adds visibility,
-- it doesn't remove the admin one.
DROP POLICY IF EXISTS ledger_entries_select_own_wallet ON ledger_entries;
CREATE POLICY ledger_entries_select_own_wallet ON ledger_entries FOR SELECT USING (
  wallet_id IS NOT NULL AND auth.uid() IN (SELECT user_id FROM wallets WHERE id = ledger_entries.wallet_id)
);

-- ----------------------------------------------------------------------------
-- Realtime
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE wallets;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE wallet_topups;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
