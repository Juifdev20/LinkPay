-- 088 — Déverrouillage d'urgence d'une journée de caisse clôturée (code secret personnel + historique).
-- Rejouable. Ne modifie aucun solde, aucune écriture d'argent (`ledger_entries`, portefeuilles).
-- Dépend de 087 (cash_day_closings).

-- Code secret de déverrouillage de chaque vendeur / caissier / gérant (haché, jamais en clair).
CREATE TABLE IF NOT EXISTS cash_unlock_secrets (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  secret_hash TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Historique de tout ce qui touche au déverrouillage : date et heure précises (horloge de la base).
CREATE TABLE IF NOT EXISTS cash_unlock_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  closing_id UUID REFERENCES cash_day_closings(id) ON DELETE SET NULL,
  business_day DATE,
  currency TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name TEXT,
  action TEXT NOT NULL CHECK (action IN ('unlock', 'failed_attempt', 'blocked', 'secret_set', 'secret_changed')),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_unlock_events_station ON cash_unlock_events (merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_unlock_events_org ON cash_unlock_events (organization_id, created_at DESC);

-- Écriture réservée au service (clé service_role), comme les autres tables d'argent (migration 044).
ALTER TABLE cash_unlock_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_unlock_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cash_unlock_secrets FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON cash_unlock_events FROM anon, authenticated;
