-- ============================================================================
-- 025_personal_expense_tracker.sql — Personal daily expense tracker
-- ("gestion de dépenses"), for every role EXCEPT enterprise (organizations
-- get their own separate, richer expense feature — see
-- 019_organization_expenses.sql — deliberately not touched here, different
-- table, different owner).
--
-- One row per user per calendar day (`expense_days`), entries logged
-- against it (`expense_entries`), the user closes the day to lock it. CDF
-- and USD are tracked per-entry and NEVER summed together anywhere — same
-- rule as everywhere else in this app (see 008_multi_currency.sql) — the
-- backend computes per-currency totals with sumByCurrency() at read time,
-- same as organization_expenses' getExpensesSummary().
--
-- Gated behind a free trial + paid "Pro" monthly access:
--   - expense_tracker_settings: a SINGLE mutable row (not versioned like
--     commission_rules) — a user's own trial window is snapshotted onto
--     their own expense_pro_status row the instant it starts, so changing
--     this global default has no retroactive effect to account for.
--   - expense_pro_status: one row per user, created lazily on first real
--     use (not at signup) — trial_ends_at is fixed at creation time.
--   - expense_pro_payments: history of Pro-activation payments, same shape
--     as wallet_topups (wallet-debit is synchronous, CinetPay is
--     PENDING->SUCCESS via webhook).
--
-- Pro activation via wallet debit reuses the existing debit_wallet
-- primitive with the 'PLATFORM_FEE' entry type (already in
-- ledger_entry_type since 001_initial_schema.sql — no ALTER TYPE needed).
--
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

CREATE TABLE IF NOT EXISTS expense_days (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expense_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, expense_date)
);

CREATE INDEX IF NOT EXISTS idx_expense_days_user_date ON expense_days(user_id, expense_date DESC);

CREATE TABLE IF NOT EXISTS expense_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  day_id UUID NOT NULL REFERENCES expense_days(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- denormalized for a direct RLS check, same shape as savings_pot_entries
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency VARCHAR(10) NOT NULL DEFAULT 'CDF' CHECK (currency IN ('CDF', 'USD')),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expense_entries_day_id ON expense_entries(day_id);

CREATE TABLE IF NOT EXISTS expense_pro_status (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  trial_started_at TIMESTAMPTZ NOT NULL,
  trial_ends_at TIMESTAMPTZ NOT NULL, -- snapshotted from expense_tracker_settings.trial_days at creation time; never recomputed later
  pro_expires_at TIMESTAMPTZ, -- NULL until first payment; extended forward on each renewal, never reset back to "now"
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expense_tracker_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- singleton
  trial_days INT NOT NULL DEFAULT 14 CHECK (trial_days >= 0),
  monthly_price_cents BIGINT NOT NULL DEFAULT 500000 CHECK (monthly_price_cents > 0), -- 5,000 CDF default
  monthly_price_currency VARCHAR(10) NOT NULL DEFAULT 'CDF' CHECK (monthly_price_currency IN ('CDF', 'USD')),
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO expense_tracker_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS expense_pro_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency VARCHAR(10) NOT NULL CHECK (currency IN ('CDF', 'USD')),
  payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('wallet', 'cinetpay')),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED')),
  psp_provider VARCHAR(20),
  psp_intent_id TEXT,
  extended_to TIMESTAMPTZ, -- pro_expires_at snapshot after this payment succeeded
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expense_pro_payments_user ON expense_pro_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_expense_pro_payments_psp_intent_id ON expense_pro_payments(psp_intent_id);

-- ----------------------------------------------------------------------------
-- RLS — defense in depth; the NestJS backend writes via the service-role
-- client (bypasses RLS) same as every other module, this only matters for
-- direct/Realtime reads.
-- ----------------------------------------------------------------------------
ALTER TABLE expense_days ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expense_days_select_own ON expense_days;
CREATE POLICY expense_days_select_own ON expense_days FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

ALTER TABLE expense_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expense_entries_select_own ON expense_entries;
CREATE POLICY expense_entries_select_own ON expense_entries FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

ALTER TABLE expense_pro_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expense_pro_status_select_own ON expense_pro_status;
CREATE POLICY expense_pro_status_select_own ON expense_pro_status FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

ALTER TABLE expense_pro_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expense_pro_payments_select_own ON expense_pro_payments;
CREATE POLICY expense_pro_payments_select_own ON expense_pro_payments FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

ALTER TABLE expense_tracker_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expense_tracker_settings_select_all ON expense_tracker_settings;
CREATE POLICY expense_tracker_settings_select_all ON expense_tracker_settings FOR SELECT USING (true); -- just pricing metadata, every dashboard needs to read it to render the paywall

-- ----------------------------------------------------------------------------
-- pay_expense_pro_via_wallet — debits the main wallet (via debit_wallet,
-- which raises if the balance can't cover it — caller in application code
-- surfaces that as "insufficient balance") and extends the Pro expiry,
-- atomically in one transaction. GREATEST(NOW(), current expiry) is what
-- guarantees an early renewal never loses already-paid days.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pay_expense_pro_via_wallet(
  p_user_id UUID,
  p_wallet_id UUID,
  p_amount_cents BIGINT,
  p_currency VARCHAR,
  p_reference VARCHAR
) RETURNS TIMESTAMPTZ
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_expiry TIMESTAMPTZ;
BEGIN
  PERFORM public.debit_wallet(p_wallet_id, p_amount_cents, 'PLATFORM_FEE'::ledger_entry_type, p_reference, p_currency, jsonb_build_object('kind', 'expense_pro_subscription'));

  INSERT INTO expense_pro_status (user_id, trial_started_at, trial_ends_at, pro_expires_at)
  VALUES (p_user_id, NOW(), NOW(), NOW() + INTERVAL '30 days')
  ON CONFLICT (user_id) DO UPDATE
    SET pro_expires_at = GREATEST(NOW(), COALESCE(expense_pro_status.pro_expires_at, NOW())) + INTERVAL '30 days',
        updated_at = NOW()
  RETURNING pro_expires_at INTO v_new_expiry;

  RETURN v_new_expiry;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- extend_expense_pro — same extension logic, no wallet movement: called
-- after a CinetPay webhook confirms payment (money already collected
-- externally by the PSP).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.extend_expense_pro(
  p_user_id UUID
) RETURNS TIMESTAMPTZ
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_expiry TIMESTAMPTZ;
BEGIN
  INSERT INTO expense_pro_status (user_id, trial_started_at, trial_ends_at, pro_expires_at)
  VALUES (p_user_id, NOW(), NOW(), NOW() + INTERVAL '30 days')
  ON CONFLICT (user_id) DO UPDATE
    SET pro_expires_at = GREATEST(NOW(), COALESCE(expense_pro_status.pro_expires_at, NOW())) + INTERVAL '30 days',
        updated_at = NOW()
  RETURNING pro_expires_at INTO v_new_expiry;

  RETURN v_new_expiry;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.pay_expense_pro_via_wallet(UUID, UUID, BIGINT, VARCHAR, VARCHAR) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.extend_expense_pro(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pay_expense_pro_via_wallet(UUID, UUID, BIGINT, VARCHAR, VARCHAR) TO service_role;
GRANT EXECUTE ON FUNCTION public.extend_expense_pro(UUID) TO service_role;
