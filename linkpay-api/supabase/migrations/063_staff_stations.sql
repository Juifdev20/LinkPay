-- ============================================================================
-- 063_staff_stations.sql — Stations (the organization's stores) and the
-- station manager role.
--
-- An organization's stores (merchants.organization_id) are its "stations".
-- Every enterprise staff member now works in ONE station
-- (organization_staff.merchant_id): the API reads it into the token as
-- station_id and only lets that person reach that station's till, stock,
-- tickets, sessions and transactions. The owner keeps every station.
--
-- New role 'gerant' (station manager): runs one station — its dashboard,
-- transactions, staff (except other managers) — and may pay the
-- organization's subscription.
--
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

ALTER TABLE organization_staff
  ADD COLUMN IF NOT EXISTS merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_organization_staff_merchant ON organization_staff(merchant_id);

-- Backfill: an organization with a single store puts all its staff there.
-- With several stores, staff stay unassigned (no station access) until the
-- owner picks their station.
UPDATE organization_staff s
   SET merchant_id = m.id
  FROM merchants m
 WHERE s.merchant_id IS NULL
   AND m.organization_id = s.organization_id
   AND (SELECT COUNT(*) FROM merchants m2 WHERE m2.organization_id = s.organization_id) = 1;

INSERT INTO roles (slug, name, description, is_system)
VALUES ('gerant', 'Gérant de station', 'Dirige une station de l''entreprise : tableau de bord, employés et caisse de sa station', false)
ON CONFLICT (slug) DO NOTHING;

-- RLS backup (the API uses the service role): an org staff member only
-- manages the stock of their own station.
CREATE OR REPLACE FUNCTION public.is_stock_manager(merchant_uuid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM merchants m
    LEFT JOIN organizations o ON o.id = m.organization_id
    WHERE m.id = merchant_uuid
      AND (
        m.owner_id = auth.uid()
        OR o.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM organization_staff s
          WHERE s.user_id = auth.uid()
            AND s.organization_id = m.organization_id
            AND s.merchant_id = m.id
            AND s.deactivated_at IS NULL
        )
      )
  ) OR public.is_admin()
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- The owner, or an active station manager of the organization, pays the
-- subscription from their own wallet.
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

  PERFORM 1 FROM organizations WHERE id = p_org AND owner_id = p_user;
  IF NOT FOUND THEN
    PERFORM 1 FROM organization_staff s
      JOIN user_roles ur ON ur.user_id = s.user_id AND ur.organization_id = s.organization_id
      JOIN roles r ON r.id = ur.role_id AND r.slug = 'gerant'
     WHERE s.organization_id = p_org AND s.user_id = p_user AND s.deactivated_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'SUBSCRIPTION_NOT_OWNER'; END IF;
  END IF;
  PERFORM 1 FROM wallets WHERE id = p_wallet AND user_id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'WALLET_USER_MISMATCH'; END IF;

  INSERT INTO organization_subscriptions (organization_id) VALUES (p_org) ON CONFLICT (organization_id) DO NOTHING;
  SELECT GREATEST(COALESCE(s.expires_at, NOW()), NOW()) INTO v_start
    FROM organization_subscriptions s WHERE s.organization_id = p_org FOR UPDATE;

  SELECT * INTO v_existing FROM subscription_purchases WHERE reference = p_reference;
  IF FOUND THEN
    IF v_existing.organization_id <> p_org THEN RAISE EXCEPTION 'SUBSCRIPTION_REFERENCE_CONFLICT'; END IF;
    RETURN QUERY SELECT v_existing.expires_at;
    RETURN;
  END IF;
  v_end := v_start + make_interval(months => p_months);

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
