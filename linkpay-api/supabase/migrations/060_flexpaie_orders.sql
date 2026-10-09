-- ============================================================================
-- 060_flexpaie_orders.sql — FlexPaie payments: our reference <-> their order number.
--
-- FlexPaie answers a payment request with an "orderNumber" and can only be asked about a payment by that number
-- (GET /api/rest/v1/check/<orderNumber>). Everywhere else in ScanLinkPay a payment is found by OUR reference
-- (the one carried in the return link and stored as psp_intent_id), so this table remembers which order number
-- belongs to which reference. It is also what keeps a forged callback harmless: the status of a payment is always
-- read from FlexPaie with the order number recorded HERE, never with one found in the callback.
--
-- API only. Run once in the Supabase SQL editor (after 059).
-- ============================================================================

CREATE TABLE IF NOT EXISTS flexpaie_orders (
  reference TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE flexpaie_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON flexpaie_orders FROM PUBLIC, anon, authenticated;
GRANT ALL ON flexpaie_orders TO service_role;
