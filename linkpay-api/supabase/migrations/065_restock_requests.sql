-- ============================================================================
-- 065_restock_requests.sql — Restock requests from a station to the owner.
--
-- The station manager or the stock keeper asks the owner to buy the articles
-- that run low: the owner approves or refuses, then the station marks the
-- goods as received. Each step notifies the other side.
--
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

CREATE TABLE IF NOT EXISTS restock_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- [{ stock_item_id, name, current_qty, wanted_qty }]
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  note TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'received')),
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  received_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restock_requests_org ON restock_requests(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_restock_requests_merchant ON restock_requests(merchant_id, created_at DESC);

-- Only the API (service role) reads and writes it; access is checked there.
ALTER TABLE restock_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON restock_requests FROM anon, authenticated;
