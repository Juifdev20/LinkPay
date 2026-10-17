-- ============================================================================
-- 052_subscriptions.sql — Monthly subscription: one price, everything included.
--
-- A business (organization) subscribes by the month and gets ALL the business
-- tools (till, sales, stock, inventory, statistics, journal, staff). The super
-- admin decides from the admin screen:
--   * the price of ONE month, per currency (CDF / USD);
--   * how long a new business can try everything for free (trial_days);
--   * what happens when the trial ends / a subscription expires: 'read_only'
--     (screens open for reading, nothing can be changed) or 'blocked';
--   * how many days before expiry the patron is warned (reminder_days).
--
-- The owner pays N months from their ScanLinkPay wallet. Paying while the
-- subscription still runs ADDS the months after its current end; paying after
-- it expired restarts from now (access resumes at once). purchase_subscription()
-- does the debit, the record and the extension in one transaction, and is
-- idempotent on its reference.
--
-- All of these tables are for the API only (no direct access from the public key).
-- Run once in the Supabase SQL editor (after 051). It also removes the per-feature
-- "licence" tables of an earlier draft of this migration, if they were created.
-- ============================================================================

ALTER TYPE ledger_entry_type ADD VALUE IF NOT EXISTS 'SUBSCRIPTION';

-- Earlier per-feature draft (never used in production): drop it.
DROP FUNCTION IF EXISTS public.purchase_license(UUID, UUID, UUID, TEXT[], INT, VARCHAR, BIGINT, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.license_revenue();
DROP TABLE IF EXISTS license_purchases, organization_license_state, organization_licenses,
  license_bundle_prices, license_feature_prices, license_features, license_settings CASCADE;

CREATE TABLE IF NOT EXISTS subscription_prices (
  currency VARCHAR(10) PRIMARY KEY,
  price_month_cents BIGINT NOT NULL CHECK (price_month_cents > 0)
);

CREATE TABLE IF NOT EXISTS subscription_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  trial_days INT NOT NULL DEFAULT 30 CHECK (trial_days BETWEEN 0 AND 365),
  trial_end_mode TEXT NOT NULL DEFAULT 'read_only' CHECK (trial_end_mode IN ('read_only', 'blocked')),
  expiry_mode TEXT NOT NULL DEFAULT 'read_only' CHECK (expiry_mode IN ('read_only', 'blocked')),
  reminder_days INT[] NOT NULL DEFAULT '{7,3,1}',
  -- No business's free trial starts before this date: the day this migration is applied, so that
  -- businesses that already exist get a full trial instead of being cut off the day billing ships.
  billing_starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id)
);
ALTER TABLE subscription_settings ADD COLUMN IF NOT EXISTS billing_starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
INSERT INTO subscription_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS organization_subscriptions (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  -- NULL until the first payment (the row may exist earlier, to remember trial reminders).
  expires_at TIMESTAMPTZ,
  -- Smallest reminder threshold already sent for the current period (0 = "expired" notice sent).
  last_reminder_days INT,
  trial_last_reminder_days INT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_organization_subscriptions_expiry ON organization_subscriptions(expires_at);

CREATE TABLE IF NOT EXISTS subscription_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  purchased_by UUID NOT NULL REFERENCES auth.users(id),
  months INT NOT NULL CHECK (months > 0),
  currency VARCHAR(10) NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  reference TEXT NOT NULL UNIQUE,
  starts_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_subscription_purchases_org ON subscription_purchases(organization_id, created_at DESC);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['subscription_prices', 'subscription_settings', 'organization_subscriptions', 'subscription_purchases']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON %I TO service_role', t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- purchase_subscription: debit the owner's wallet, record the payment, extend the subscription.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purchase_subscription(
  p_org UUID,
  p_user UUID,
  p_wallet UUID,
  p_months INT,
  p_currency VARCHAR,
  p_amount BIGINT,
  p_reference TEXT
) RETURNS TABLE (expires_at TIMESTAMPTZ)
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing subscription_purchases;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
BEGIN
  IF p_months < 1 OR p_months > 24 THEN RAISE EXCEPTION 'SUBSCRIPTION_INVALID_MONTHS'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'SUBSCRIPTION_INVALID_AMOUNT'; END IF;

  -- Only the owner of the business, paying from their own wallet.
  PERFORM 1 FROM organizations WHERE id = p_org AND owner_id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUBSCRIPTION_NOT_OWNER'; END IF;
  PERFORM 1 FROM wallets WHERE id = p_wallet AND user_id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'WALLET_USER_MISMATCH'; END IF;

  -- Serialise the payments of one business (so months stack instead of overlapping), and make a
  -- same-reference retry wait for the first request instead of racing it.
  INSERT INTO organization_subscriptions (organization_id) VALUES (p_org) ON CONFLICT (organization_id) DO NOTHING;
  SELECT GREATEST(COALESCE(s.expires_at, NOW()), NOW()) INTO v_start
    FROM organization_subscriptions s WHERE s.organization_id = p_org FOR UPDATE;

  -- Same request twice (double tap, retry): nothing is charged again, the first result is returned.
  SELECT * INTO v_existing FROM subscription_purchases WHERE reference = p_reference;
  IF FOUND THEN
    IF v_existing.organization_id <> p_org THEN RAISE EXCEPTION 'SUBSCRIPTION_REFERENCE_CONFLICT'; END IF;
    RETURN QUERY SELECT v_existing.expires_at;
    RETURN;
  END IF;
  v_end := v_start + make_interval(months => p_months);

  -- Raises 'Insufficient balance' when the wallet doesn't hold enough.
  PERFORM debit_wallet(p_wallet, p_amount, 'SUBSCRIPTION', 'SUBSCRIPTION-' || p_reference, p_currency,
    jsonb_build_object('organization_id', p_org, 'months', p_months));

  INSERT INTO subscription_purchases (organization_id, purchased_by, months, currency, amount_cents, reference, starts_at, expires_at)
  VALUES (p_org, p_user, p_months, p_currency, p_amount, p_reference, v_start, v_end);

  UPDATE organization_subscriptions s
     SET expires_at = v_end, last_reminder_days = NULL, updated_at = NOW()
   WHERE s.organization_id = p_org;

  RETURN QUERY SELECT v_end;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.purchase_subscription(UUID, UUID, UUID, INT, VARCHAR, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_subscription(UUID, UUID, UUID, INT, VARCHAR, BIGINT, TEXT) TO service_role;

-- What the platform earned from subscriptions, per currency (for the super admin screen).
CREATE OR REPLACE FUNCTION public.subscription_revenue()
RETURNS TABLE (currency VARCHAR, total_cents BIGINT, purchases BIGINT)
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT currency, SUM(amount_cents)::BIGINT, COUNT(*)::BIGINT FROM subscription_purchases GROUP BY currency
$$ LANGUAGE sql STABLE;

REVOKE ALL ON FUNCTION public.subscription_revenue() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_revenue() TO service_role;
