-- ============================================================================
-- 031_stock_management.sql — Gestion de stock et approvisionnement (module
-- Entreprise), première tranche des modules métier, personnalisée pour le
-- secteur "Shop d'appareils électroniques" (organizations.sector =
-- 'electronique') via des colonnes optionnelles (marque/modèle/n° de
-- série/état/garantie) qui restent NULL et sans effet pour tout autre
-- secteur — pas de branchement par secteur au niveau du schéma, seul le
-- frontend affiche ces champs conditionnellement.
--
-- Scopé par boutique (merchant_id), jamais par organization_id directement
-- — même principe que `transactions.merchant_id` : une vue "toute
-- l'entreprise" fait toujours le tour des boutiques de l'organisation
-- d'abord (voir organizations.service.ts getOrganizationStoresBreakdown())
-- plutôt que de dénormaliser organization_id sur cette table.
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE stock_item_condition AS ENUM ('neuf', 'occasion', 'reconditionne');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE stock_movement_type AS ENUM ('in', 'out', 'adjustment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS stock_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  brand VARCHAR(255),
  model VARCHAR(255),
  serial_number VARCHAR(255) UNIQUE,
  condition stock_item_condition,
  warranty_months INT,
  quantity INT NOT NULL DEFAULT 0,
  unit_price_cents BIGINT NOT NULL DEFAULT 0,
  cost_price_cents BIGINT,
  currency VARCHAR(10) NOT NULL DEFAULT 'CDF',
  low_stock_threshold INT NOT NULL DEFAULT 5,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stock_item_id UUID NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  type stock_movement_type NOT NULL,
  quantity_delta INT NOT NULL,
  reason TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_items_merchant_id ON stock_items(merchant_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_stock_item_id ON stock_movements(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_merchant_id ON stock_movements(merchant_id);

DROP TRIGGER IF EXISTS set_updated_at ON stock_items;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON stock_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Keeps stock_items.quantity in lockstep with its movement history at the
-- database level — the application only ever inserts a stock_movements row
-- (never writes quantity directly), same reasoning as the wallet_number/
-- scanlinkpay_number generator triggers already in this project: a single
-- source of truth that can't drift out of sync with app-layer bugs.
CREATE OR REPLACE FUNCTION public.apply_stock_movement()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE stock_items
  SET quantity = quantity + NEW.quantity_delta
  WHERE id = NEW.stock_item_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_apply_stock_movement ON stock_movements;
CREATE TRIGGER trg_apply_stock_movement
  AFTER INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.apply_stock_movement();

ALTER TABLE stock_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

-- is_merchant_user() (001_initial_schema.sql) only covers user_roles rows
-- scoped by merchant_id — enterprise-staff roles (magasinier included) and
-- the organization owner are scoped by organization_id instead (see
-- organization-staff module), so it alone would wrongly reject them here.
-- A dedicated helper folds in every legitimate path: the merchant's own
-- owner_id, the owning organization's owner_id, any org-scoped staff
-- member of that same organization, or a platform admin.
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
          SELECT 1 FROM user_roles ur
          WHERE ur.user_id = auth.uid() AND ur.organization_id = m.organization_id
        )
      )
  ) OR public.is_admin()
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

DROP POLICY IF EXISTS stock_items_select ON stock_items;
CREATE POLICY stock_items_select ON stock_items FOR SELECT USING (public.is_stock_manager(stock_items.merchant_id));
DROP POLICY IF EXISTS stock_items_insert ON stock_items;
CREATE POLICY stock_items_insert ON stock_items FOR INSERT WITH CHECK (public.is_stock_manager(stock_items.merchant_id));
DROP POLICY IF EXISTS stock_items_update ON stock_items;
CREATE POLICY stock_items_update ON stock_items FOR UPDATE USING (public.is_stock_manager(stock_items.merchant_id));
DROP POLICY IF EXISTS stock_items_delete ON stock_items;
CREATE POLICY stock_items_delete ON stock_items FOR DELETE USING (public.is_stock_manager(stock_items.merchant_id));

DROP POLICY IF EXISTS stock_movements_select ON stock_movements;
CREATE POLICY stock_movements_select ON stock_movements FOR SELECT USING (public.is_stock_manager(stock_movements.merchant_id));
DROP POLICY IF EXISTS stock_movements_insert ON stock_movements;
CREATE POLICY stock_movements_insert ON stock_movements FOR INSERT WITH CHECK (public.is_stock_manager(stock_movements.merchant_id));
