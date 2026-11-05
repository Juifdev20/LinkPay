-- ============================================================================
-- 092_abonnement_manuel.sql — Le super admin active ou désactive un abonnement à la main.
--
--   * grant_subscription : ajoute N jours (ou N mois) d'abonnement à une entreprise, sans paiement. Comme un achat, les
--     jours s'ajoutent à la fin de l'abonnement en cours, ou repartent de maintenant s'il est fini (accès immédiat).
--   * revoke_subscription : met fin à l'abonnement en cours (date de fin = maintenant). L'entreprise peut ensuite
--     s'abonner normalement avec son portefeuille.
--
-- Chaque opération est gardée dans subscription_grants (qui, quand, combien, avant/après, motif) : les accès offerts ne se
-- mélangent pas aux paiements (subscription_purchases) et les recettes restent justes.
-- Tout passe par l'API (service_role) ; aucun accès direct. À exécuter une fois dans l'éditeur SQL de Supabase, après 091.
-- Rejouable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS subscription_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  granted_by UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL CHECK (action IN ('grant', 'revoke')),
  amount INT CHECK (amount IS NULL OR amount > 0),
  unit TEXT CHECK (unit IS NULL OR unit IN ('days', 'months')),
  previous_expires_at TIMESTAMPTZ,
  new_expires_at TIMESTAMPTZ,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_subscription_grants_org ON subscription_grants(organization_id, created_at DESC);

ALTER TABLE subscription_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON subscription_grants FROM PUBLIC, anon, authenticated;
GRANT ALL ON subscription_grants TO service_role;

CREATE OR REPLACE FUNCTION public.grant_subscription(
  p_org UUID,
  p_admin UUID,
  p_amount INT,
  p_unit TEXT,
  p_reason TEXT
) RETURNS TABLE (new_expires_at TIMESTAMPTZ)
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev TIMESTAMPTZ;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
BEGIN
  IF p_unit NOT IN ('days', 'months') THEN RAISE EXCEPTION 'GRANT_INVALID_UNIT'; END IF;
  IF p_unit = 'days' AND (p_amount < 1 OR p_amount > 730) THEN RAISE EXCEPTION 'GRANT_INVALID_AMOUNT'; END IF;
  IF p_unit = 'months' AND (p_amount < 1 OR p_amount > 24) THEN RAISE EXCEPTION 'GRANT_INVALID_AMOUNT'; END IF;
  PERFORM 1 FROM organizations WHERE id = p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'GRANT_ORG_NOT_FOUND'; END IF;

  -- Même verrou que purchase_subscription : un achat et une activation en même temps s'additionnent, ne se chevauchent pas.
  INSERT INTO organization_subscriptions (organization_id) VALUES (p_org) ON CONFLICT (organization_id) DO NOTHING;
  SELECT s.expires_at INTO v_prev FROM organization_subscriptions s WHERE s.organization_id = p_org FOR UPDATE;
  v_start := GREATEST(COALESCE(v_prev, NOW()), NOW());
  v_end := v_start + CASE WHEN p_unit = 'days' THEN make_interval(days => p_amount) ELSE make_interval(months => p_amount) END;

  UPDATE organization_subscriptions s
     SET expires_at = v_end, last_reminder_days = NULL, updated_at = NOW()
   WHERE s.organization_id = p_org;

  INSERT INTO subscription_grants (organization_id, granted_by, action, amount, unit, previous_expires_at, new_expires_at, reason)
  VALUES (p_org, p_admin, 'grant', p_amount, p_unit, v_prev, v_end, NULLIF(BTRIM(p_reason), ''));

  RETURN QUERY SELECT v_end;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.revoke_subscription(
  p_org UUID,
  p_admin UUID,
  p_reason TEXT
) RETURNS TABLE (previous_expires_at TIMESTAMPTZ, new_expires_at TIMESTAMPTZ)
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev TIMESTAMPTZ;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT s.expires_at INTO v_prev FROM organization_subscriptions s WHERE s.organization_id = p_org FOR UPDATE;
  IF NOT FOUND OR v_prev IS NULL OR v_prev <= v_now THEN RAISE EXCEPTION 'REVOKE_NOTHING_TO_REVOKE'; END IF;

  UPDATE organization_subscriptions s
     SET expires_at = v_now, last_reminder_days = NULL, updated_at = v_now
   WHERE s.organization_id = p_org;

  INSERT INTO subscription_grants (organization_id, granted_by, action, previous_expires_at, new_expires_at, reason)
  VALUES (p_org, p_admin, 'revoke', v_prev, v_now, NULLIF(BTRIM(p_reason), ''));

  RETURN QUERY SELECT v_prev, v_now;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.grant_subscription(UUID, UUID, INT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_subscription(UUID, UUID, INT, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.revoke_subscription(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_subscription(UUID, UUID, TEXT) TO service_role;
