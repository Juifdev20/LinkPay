-- ============================================================================
-- 034_sales.sql — Ventes de l'entreprise (module Ventes).
--
-- Une vente = un panier d'articles de stock + un paiement. Le paiement passe
-- par le flux wallet existant (payment_requests -> payWithWallet ->
-- transactions), ou est enregistré payé immédiatement en espèces.
--
-- unit_cost_cents est figé au moment de la vente (copié depuis
-- stock_items.cost_price_cents) : les marges passées ne doivent pas bouger
-- si le prix d'achat d'un article change ensuite.
-- Exécuter une fois dans le SQL Editor de Supabase.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sales (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  reference VARCHAR(100) UNIQUE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'CANCELLED')),
  payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('wallet', 'cash')),
  currency VARCHAR(10) NOT NULL DEFAULT 'CDF',
  total_cents BIGINT NOT NULL CHECK (total_cents >= 0),
  payment_request_id UUID REFERENCES payment_requests(id) ON DELETE SET NULL,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sale_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  stock_item_id UUID REFERENCES stock_items(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  quantity INT NOT NULL CHECK (quantity > 0),
  unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents >= 0),
  unit_cost_cents BIGINT NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  currency VARCHAR(10) NOT NULL DEFAULT 'CDF',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_organization_id ON sales(organization_id);
CREATE INDEX IF NOT EXISTS idx_sales_paid_at ON sales(paid_at);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_stock_item_id ON sale_items(stock_item_id);

DROP TRIGGER IF EXISTS set_updated_at ON sales;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON sales
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_select ON sales;
CREATE POLICY sales_select ON sales FOR SELECT USING (public.is_stock_manager(sales.merchant_id));

DROP POLICY IF EXISTS sale_items_select ON sale_items;
CREATE POLICY sale_items_select ON sale_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_items.sale_id AND public.is_stock_manager(s.merchant_id))
);

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE sales;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
