-- 035_sales_history_and_invoice.sql
-- Invoice detail and sales history.
--
-- sale_items.details: snapshot of the product sheet at the time of the sale
-- (brand, model, condition, serial/IMEI, warranty, category attributes such as
-- RAM or storage). Stored once per line so the invoice stays correct even if
-- the stock item is edited or deleted later.
--
-- sales.history_hidden_at: archive flag. Setting it removes the sale from the
-- history list only. The sale row and its lines are never deleted, so the
-- dashboards and the accounting totals are unchanged.

ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS history_hidden_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_sales_history_visible
  ON sales (organization_id, created_at DESC)
  WHERE history_hidden_at IS NULL;
