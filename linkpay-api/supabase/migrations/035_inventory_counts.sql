-- ============================================================================
-- 035_inventory_counts.sql — Module Supermarché, Phase 3: inventaires
-- physiques (spec 1.4 — inventaires tournants par catégorie ou totaux,
-- saisie des comptages, régularisation avec rapport de démarque).
--
-- Un inventory_count fige au démarrage une ligne par produit en rayon
-- (scope_category NULL = inventaire total) avec le stock THÉORIQUE
-- (expected_qty). Le comptage se saisit ensuite sans interrompre les ventes :
-- à la validation, l'ajustement appliqué est counted − quantité COURANTE
-- (pas counted − expected, sinon une vente passée pendant le comptage serait
-- comptée deux fois), tandis que le rapport d'écarts compare counted −
-- expected pour la démarque.
--
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory_counts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  -- NULL = inventaire total ; sinon une des catégories de stock_items
  -- (inventaire tournant par rayon).
  scope_category VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'counting' CHECK (status IN ('counting', 'completed', 'cancelled')),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  completed_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS inventory_count_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  count_id UUID NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
  stock_item_id UUID NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
  product_name_snapshot VARCHAR(255) NOT NULL,
  category_snapshot VARCHAR(100),
  unit_price_cents_snapshot BIGINT NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'CDF',
  expected_qty INT NOT NULL,
  counted_qty INT,                 -- NULL tant que la ligne n'est pas comptée
  variance INT,                    -- counted − expected, figé à la validation
  counted_at TIMESTAMPTZ,
  UNIQUE (count_id, stock_item_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_counts_merchant_id ON inventory_counts(merchant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_count_lines_count_id ON inventory_count_lines(count_id);

-- RLS — même garde que le reste du module : is_stock_manager couvre le
-- propriétaire de la boutique, le propriétaire de l'organisation et les
-- employés de l'org (magasinier notamment). Le backend écrit via le
-- service-role en parallèle.
ALTER TABLE inventory_counts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_counts_select ON inventory_counts;
CREATE POLICY inventory_counts_select ON inventory_counts FOR SELECT USING (public.is_stock_manager(inventory_counts.merchant_id));
DROP POLICY IF EXISTS inventory_counts_insert ON inventory_counts;
CREATE POLICY inventory_counts_insert ON inventory_counts FOR INSERT WITH CHECK (public.is_stock_manager(inventory_counts.merchant_id));
DROP POLICY IF EXISTS inventory_counts_update ON inventory_counts;
CREATE POLICY inventory_counts_update ON inventory_counts FOR UPDATE USING (public.is_stock_manager(inventory_counts.merchant_id));

ALTER TABLE inventory_count_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_count_lines_select ON inventory_count_lines;
CREATE POLICY inventory_count_lines_select ON inventory_count_lines FOR SELECT USING (
  EXISTS (SELECT 1 FROM inventory_counts c WHERE c.id = inventory_count_lines.count_id AND public.is_stock_manager(c.merchant_id))
);
DROP POLICY IF EXISTS inventory_count_lines_insert ON inventory_count_lines;
CREATE POLICY inventory_count_lines_insert ON inventory_count_lines FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM inventory_counts c WHERE c.id = inventory_count_lines.count_id AND public.is_stock_manager(c.merchant_id))
);
DROP POLICY IF EXISTS inventory_count_lines_update ON inventory_count_lines;
CREATE POLICY inventory_count_lines_update ON inventory_count_lines FOR UPDATE USING (
  EXISTS (SELECT 1 FROM inventory_counts c WHERE c.id = inventory_count_lines.count_id AND public.is_stock_manager(c.merchant_id))
);
