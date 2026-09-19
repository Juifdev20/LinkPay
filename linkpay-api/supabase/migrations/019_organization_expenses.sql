-- ============================================================================
-- 019_organization_expenses.sql — Manual expense tracking for the
-- enterprise dashboard's "Montant réel encaissé" reconciliation tile
-- (electronic revenue + cash revenue − expenses).
--
-- No POS/caisse module exists yet to record expenses automatically, so this
-- is deliberately just a flat manual-entry table — enough for an owner to
-- log "I spent X on Y" from the dashboard. Expect this to be superseded or
-- extended once the Caisse tranche lands.
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

CREATE TABLE IF NOT EXISTS organization_expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency VARCHAR(10) DEFAULT 'CDF',
  description TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organization_expenses_org_id ON organization_expenses(organization_id);

ALTER TABLE organization_expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_expenses_select_own ON organization_expenses;
CREATE POLICY organization_expenses_select_own ON organization_expenses FOR SELECT USING (
  auth.uid() IN (SELECT owner_id FROM organizations WHERE id = organization_expenses.organization_id)
  OR public.is_admin()
);
