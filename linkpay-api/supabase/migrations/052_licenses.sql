-- ============================================================================
-- 052_licenses.sql — Licences: businesses buy the features they use, by the day.
--
-- The super admin decides everything from the admin screen:
--   * which features exist as paid licences, and their price PER DAY (per currency);
--   * an optional "all features" price per day (otherwise the sum of the prices);
--   * how long a new business can try everything for free (trial_days);
--   * what happens when the trial ends / a licence expires: 'read_only' (the
--     screens still open for reading, nothing can be changed) or 'blocked';
--   * how many days before expiry the patron is warned (reminder_days).
--
-- A business (organization) buys N days of any set of features, paid from its
-- owner's ScanLinkPay wallet. Buying while a licence is still running ADDS the
-- days after its current end ("just add days and pay"). purchase_license() does
-- the debit, the purchase record and the extension in one transaction, and is
-- idempotent on its reference.
--
-- All of these tables are for the API only (no direct access from the public key).
-- Run once in the Supabase SQL editor (after 051).
-- ============================================================================

ALTER TYPE ledger_entry_type ADD VALUE IF NOT EXISTS 'LICENSE';

CREATE TABLE IF NOT EXISTS license_features (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS license_feature_prices (
  feature_key TEXT NOT NULL REFERENCES license_features(key) ON DELETE CASCADE,
  currency VARCHAR(10) NOT NULL,
  price_per_day_cents BIGINT NOT NULL CHECK (price_per_day_cents >= 0),
  PRIMARY KEY (feature_key, currency)
);

CREATE TABLE IF NOT EXISTS license_bundle_prices (
  currency VARCHAR(10) PRIMARY KEY,
  price_per_day_cents BIGINT NOT NULL CHECK (price_per_day_cents >= 0)
);

CREATE TABLE IF NOT EXISTS license_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  trial_days INT NOT NULL DEFAULT 30 CHECK (trial_days BETWEEN 0 AND 365),
  trial_end_mode TEXT NOT NULL DEFAULT 'read_only' CHECK (trial_end_mode IN ('read_only', 'blocked')),
  expiry_mode TEXT NOT NULL DEFAULT 'read_only' CHECK (expiry_mode IN ('read_only', 'blocked')),
  reminder_days INT[] NOT NULL DEFAULT '{7,3,1}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id)
);
INSERT INTO license_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS organization_licenses (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL REFERENCES license_features(key) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  -- Smallest reminder threshold already sent for the current period (0 = "expired" notice sent).
  last_reminder_days INT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, feature_key)
);
CREATE INDEX IF NOT EXISTS idx_organization_licenses_expiry ON organization_licenses(expires_at);

-- Trial reminders (the trial has no licence row).
CREATE TABLE IF NOT EXISTS organization_license_state (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  trial_last_reminder_days INT
);

CREATE TABLE IF NOT EXISTS license_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  purchased_by UUID NOT NULL REFERENCES auth.users(id),
  features TEXT[] NOT NULL,
  is_bundle BOOLEAN NOT NULL DEFAULT FALSE,
  days INT NOT NULL CHECK (days > 0),
  currency VARCHAR(10) NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  reference TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_license_purchases_org ON license_purchases(organization_id, created_at DESC);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['license_features', 'license_feature_prices', 'license_bundle_prices', 'license_settings',
                           'organization_licenses', 'organization_license_state', 'license_purchases']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON %I TO service_role', t);
  END LOOP;
END $$;

-- The licensable features. Keys are tied to the code (what each one unlocks);
-- the super admin renames, enables/disables and prices them. No price = not on sale yet.
INSERT INTO license_features (key, name, description, sort_order) VALUES
  ('pos',       'Caisse (point de vente)',      'Caisse enregistreuse, tickets, sessions de caisse, scan des produits.', 10),
  ('sales',     'Ventes et factures',           'Saisie des ventes, historique, tableau de bord des ventes, factures.', 20),
  ('stock',     'Stock et approvisionnement',   'Articles, entrées et sorties de stock, réapprovisionnement.', 30),
  ('inventory', 'Inventaire',                   'Comptages d''inventaire et rapport de démarque.', 40),
  ('stats',     'Statistiques',                 'Statistiques de la caisse : ventes par jour, produits les plus vendus, stock dormant.', 50),
  ('audit',     'Journal d''activité',          'Traçabilité : qui a fait quoi.', 60),
  ('staff',     'Employés et rôles',            'Création des employés, rôles, retrait d''accès.', 70)
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- purchase_license: debit the owner's wallet, record the purchase, extend the licences.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purchase_license(
  p_org UUID,
  p_user UUID,
  p_wallet UUID,
  p_features TEXT[],
  p_days INT,
  p_currency VARCHAR,
  p_amount BIGINT,
  p_bundle BOOLEAN,
  p_reference TEXT
) RETURNS TABLE (feature_key TEXT, expires_at TIMESTAMPTZ)
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing license_purchases;
  v_feature TEXT;
BEGIN
  IF p_days < 1 OR p_days > 3650 THEN RAISE EXCEPTION 'LICENSE_INVALID_DAYS'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'LICENSE_INVALID_AMOUNT'; END IF;
  IF p_features IS NULL OR array_length(p_features, 1) IS NULL THEN RAISE EXCEPTION 'LICENSE_NO_FEATURE'; END IF;

  -- Only the owner of the business, paying from their own wallet.
  PERFORM 1 FROM organizations WHERE id = p_org AND owner_id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'LICENSE_NOT_OWNER'; END IF;
  PERFORM 1 FROM wallets WHERE id = p_wallet AND user_id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'WALLET_USER_MISMATCH'; END IF;

  -- Same request twice (double tap, retry): nothing is charged again.
  SELECT * INTO v_existing FROM license_purchases WHERE reference = p_reference;
  IF FOUND THEN
    RETURN QUERY
      SELECT l.feature_key, l.expires_at FROM organization_licenses l
       WHERE l.organization_id = v_existing.organization_id AND l.feature_key = ANY (v_existing.features);
    RETURN;
  END IF;

  FOREACH v_feature IN ARRAY p_features LOOP
    PERFORM 1 FROM license_features WHERE key = v_feature AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'LICENSE_UNKNOWN_FEATURE:%', v_feature; END IF;
  END LOOP;

  -- Raises 'Insufficient balance' when the wallet doesn't hold enough.
  PERFORM debit_wallet(p_wallet, p_amount, 'LICENSE', 'LICENSE-' || p_reference, p_currency,
    jsonb_build_object('organization_id', p_org, 'features', p_features, 'days', p_days, 'bundle', p_bundle));

  INSERT INTO license_purchases (organization_id, purchased_by, features, is_bundle, days, currency, amount_cents, reference)
  VALUES (p_org, p_user, p_features, p_bundle, p_days, p_currency, p_amount, p_reference);

  FOREACH v_feature IN ARRAY p_features LOOP
    INSERT INTO organization_licenses AS l (organization_id, feature_key, expires_at)
    VALUES (p_org, v_feature, NOW() + make_interval(days => p_days))
    ON CONFLICT ON CONSTRAINT organization_licenses_pkey DO UPDATE
      SET expires_at = GREATEST(l.expires_at, NOW()) + make_interval(days => p_days),
          last_reminder_days = NULL,
          updated_at = NOW();
  END LOOP;

  RETURN QUERY
    SELECT l.feature_key, l.expires_at FROM organization_licenses l
     WHERE l.organization_id = p_org AND l.feature_key = ANY (p_features);
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.purchase_license(UUID, UUID, UUID, TEXT[], INT, VARCHAR, BIGINT, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_license(UUID, UUID, UUID, TEXT[], INT, VARCHAR, BIGINT, BOOLEAN, TEXT) TO service_role;

-- What the platform earned from licences, per currency (for the super admin screen).
CREATE OR REPLACE FUNCTION public.license_revenue()
RETURNS TABLE (currency VARCHAR, total_cents BIGINT, purchases BIGINT)
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT currency, SUM(amount_cents)::BIGINT, COUNT(*)::BIGINT FROM license_purchases GROUP BY currency
$$ LANGUAGE sql STABLE;

REVOKE ALL ON FUNCTION public.license_revenue() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.license_revenue() TO service_role;
