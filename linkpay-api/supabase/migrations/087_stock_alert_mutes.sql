-- ============================================================================
-- 087_stock_alert_mutes.sql — Stock alerts that repeat every 24 h until the user mutes them.
--
-- "Stock bas" / "Rupture de stock" is announced (voice in the app, sound notification when it is closed) when an article crosses its
-- threshold, then AGAIN every 24 h while it is still low — until the stock is refilled or the user turns the alert off himself.
--  - stock_items.low_alert_sent_at : when the last alert for this article went out (drives the 24 h repeat).
--  - stock_alert_mutes : what a user switched off. stock_item_id NULL = every stock alert; otherwise that article only.
--
-- Run in the Supabase SQL editor (LinkPay Test first, then production), after 086.
-- ============================================================================

ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS low_alert_sent_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS stock_alert_mutes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stock_item_id UUID REFERENCES stock_items(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One mute per user and article, and at most one "everything" mute per user.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_alert_mutes_item ON stock_alert_mutes(user_id, stock_item_id) WHERE stock_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_alert_mutes_all ON stock_alert_mutes(user_id) WHERE stock_item_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_stock_alert_mutes_item ON stock_alert_mutes(stock_item_id) WHERE stock_item_id IS NOT NULL;

-- The reminder job looks for articles that are low AND not alerted for 24 h.
CREATE INDEX IF NOT EXISTS idx_stock_items_low_alert ON stock_items(low_alert_sent_at);

-- Only the API (service role) reads and writes it; access is checked there.
ALTER TABLE stock_alert_mutes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON stock_alert_mutes FROM anon, authenticated;
