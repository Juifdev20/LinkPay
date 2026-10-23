-- ============================================================================
-- 085_supplier_stations.sql — A supplier sells from SEVERAL stations (decision of 23/10, DECISIONS.md).
--
-- One supplier space per enterprise (one number, one Fournisseur plan for all its stations), but the owner ticks the
-- stations that sell (Goma, Beni…). Each one has its own catalog (drawn from its own stock, its own business prices),
-- its own default delivery fee and zone. The client picks the station that serves it when ordering; the order goes to
-- that station's managers, leaves its stock and is paid to it.
-- supplier_profiles.merchant_id stays: the first station (and the one used before this migration).
--
-- Run in the Supabase SQL editor (LinkPay Test first, then production), after 084.
-- ============================================================================

CREATE TABLE IF NOT EXISTS supplier_stations (
  supplier_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  delivery_zone VARCHAR(255),
  default_delivery_fee_cents BIGINT CHECK (default_delivery_fee_cents IS NULL OR default_delivery_fee_cents >= 0),
  default_delivery_currency VARCHAR(3) CHECK (default_delivery_currency IS NULL OR default_delivery_currency IN ('CDF', 'USD')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (supplier_org_id, merchant_id)
);

-- The station of every existing supplier becomes its first selling station.
INSERT INTO supplier_stations (supplier_org_id, merchant_id, delivery_zone, default_delivery_fee_cents, default_delivery_currency)
SELECT organization_id, merchant_id, delivery_zone, default_delivery_fee_cents, default_delivery_currency
  FROM supplier_profiles
ON CONFLICT (supplier_org_id, merchant_id) DO NOTHING;

-- Each catalog line belongs to the station whose stock it comes from.
ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE;
UPDATE supplier_catalog_items c SET merchant_id = s.merchant_id
  FROM stock_items s
 WHERE s.id = c.stock_item_id AND c.merchant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_catalog_station ON supplier_catalog_items(supplier_org_id, merchant_id) WHERE active;

-- Only the API (service role) reads and writes it; access is checked there.
ALTER TABLE supplier_stations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON supplier_stations FROM anon, authenticated;
