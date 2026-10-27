-- 087 — Caisse de station : dépenses à valider, clôture quotidienne de la caisse (livre de caisse).
-- Rejouable. Ne modifie aucun solde, aucune écriture d'argent (`ledger_entries`, portefeuilles) :
-- ce sont des enregistrements comptables (comptage de caisse, catégorie et statut d'une dépense).

-- Dépenses de station saisies par le vendeur / caissier : comptées tout de suite, « à valider » par le gérant ou le patron.
ALTER TABLE organization_expenses ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE organization_expenses ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE organization_expenses ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE organization_expenses ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE organization_expenses ADD COLUMN IF NOT EXISTS reject_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_expenses_status_check') THEN
    ALTER TABLE organization_expenses
      ADD CONSTRAINT organization_expenses_status_check CHECK (status IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_org_expenses_pending ON organization_expenses (merchant_id, status) WHERE status = 'pending';

-- Clôture quotidienne : une ligne par station, par jour (fuseau de l'entreprise) et par devise.
-- Une journée clôturée est verrouillée ; le patron ou le gérant peut la rouvrir (motif obligatoire), la clôture suivante
-- remplace les chiffres et augmente `version`.
CREATE TABLE IF NOT EXISTS cash_day_closings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  business_day DATE NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('CDF', 'USD')),
  status TEXT NOT NULL DEFAULT 'closed' CHECK (status IN ('closed', 'reopened')),
  version INT NOT NULL DEFAULT 1,
  opening_cents BIGINT NOT NULL DEFAULT 0,
  cash_sales_cents BIGINT NOT NULL DEFAULT 0,
  cash_in_cents BIGINT NOT NULL DEFAULT 0,
  expenses_cents BIGINT NOT NULL DEFAULT 0,
  cash_out_cents BIGINT NOT NULL DEFAULT 0,
  expected_cents BIGINT NOT NULL DEFAULT 0,
  counted_cents BIGINT NOT NULL DEFAULT 0,
  discrepancy_cents BIGINT NOT NULL DEFAULT 0,
  non_cash_cents BIGINT NOT NULL DEFAULT 0,
  sales_count INT NOT NULL DEFAULT 0,
  note TEXT,
  closed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ,
  reopened_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reopened_at TIMESTAMPTZ,
  reopen_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (merchant_id, business_day, currency)
);

CREATE INDEX IF NOT EXISTS idx_cash_day_closings_org_day ON cash_day_closings (organization_id, business_day DESC);
CREATE INDEX IF NOT EXISTS idx_cash_day_closings_station_day ON cash_day_closings (merchant_id, business_day DESC);

-- Écriture réservée au service (clé service_role), comme les autres tables d'argent (migration 044).
ALTER TABLE cash_day_closings ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON cash_day_closings FROM anon, authenticated;
