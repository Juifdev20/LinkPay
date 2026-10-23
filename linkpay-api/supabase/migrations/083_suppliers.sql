-- ============================================================================
-- 083_suppliers.sql — An enterprise's suppliers, and the supplier of each product (all sectors).
--
-- Optional everywhere: a product may have no supplier. In the product sheet the supplier is picked from this list, or
-- typed by hand (the API then adds it to the list). Kept per enterprise, shared by its stations.
-- `supplier_org_id` is for the supplier network (phase C, DECISIONS.md 23/10): set when the supplier is itself an
-- enterprise on ScanLinkPay that accepted the invitation; NULL for a supplier typed by hand.
-- Never deleted while products point to it: archived instead (products keep their history).
--
-- Run in the Supabase SQL editor (LinkPay Test first, then production), after 082.
-- ============================================================================

CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL CHECK (length(btrim(name)) > 0),
  phone VARCHAR(30),
  email VARCHAR(160),
  address VARCHAR(255),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 1000),
  supplier_org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  archived_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One active supplier per name in an enterprise ("Bralima" and "bralima " are the same one).
CREATE UNIQUE INDEX IF NOT EXISTS uq_suppliers_org_name
  ON suppliers(organization_id, lower(btrim(name))) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_suppliers_org ON suppliers(organization_id) WHERE archived_at IS NULL;

ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_stock_items_supplier ON stock_items(supplier_id) WHERE supplier_id IS NOT NULL;

-- Only the API (service role) reads and writes it; access is checked there.
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON suppliers FROM anon, authenticated;
