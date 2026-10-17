-- ============================================================================
-- 064_stock_password_optional.sql — The stock management password becomes an
-- option the owner switches on or off (off by default).
--
-- Off: only the role counts — the owner and the stock keeper change the
-- stock, everyone else reads it; every change stays in the audit journal.
-- On: the shared password is asked as before (adding/editing/removing an
-- article, a movement, validating an inventory, archiving a sale).
--
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS stock_password_required BOOLEAN NOT NULL DEFAULT false;
