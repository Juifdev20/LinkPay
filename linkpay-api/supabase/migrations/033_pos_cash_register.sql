-- ============================================================================
-- 033_pos_cash_register.sql — Module Supermarché, Phase 1: point of sale,
-- automatic stock deduction, cash register.
--
-- Builds on top of the Stock & Approvisionnement module from
-- 031_stock_management.sql rather than replacing it: stock_items becomes the
-- sellable product catalog (adds category + barcode), and a sale deducts
-- stock through the EXISTING stock_movements ledger (a new 'sale' movement
-- type) so the already-working trigger (trg_apply_stock_movement) and
-- low-stock notification in StockService.createMovement() apply to POS
-- sales automatically, with no duplicated logic.
--
-- A ticket is always a single currency (CDF or USD), chosen by the cashier
-- when the sale starts — never mixed on one ticket, matching how cash
-- actually works at a physical till (one drawer per currency).
--
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS category VARCHAR(100);
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS barcode VARCHAR(100);
-- Scoped per store, not globally unique: two different stores may
-- legitimately sell the same product (same EAN/UPC barcode).
ALTER TABLE stock_items DROP CONSTRAINT IF EXISTS stock_items_merchant_barcode_unique;
ALTER TABLE stock_items ADD CONSTRAINT stock_items_merchant_barcode_unique UNIQUE (merchant_id, barcode);

-- New movement type so a POS sale is distinguishable from a manual
-- adjustment/loss in the existing stock_movements history. Postgres forbids
-- using a freshly-added enum value in the same transaction it was added in —
-- the explicit COMMIT below is required before 'sale' is referenced by any
-- later statement in this script (same lesson already learned on this
-- project with ledger_entry_type).
ALTER TYPE stock_movement_type ADD VALUE IF NOT EXISTS 'sale';
COMMIT;

CREATE TABLE IF NOT EXISTS pos_tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  cashier_user_id UUID NOT NULL REFERENCES auth.users(id),
  cash_register_session_id UUID, -- FK added below, after cash_register_sessions exists
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'cancelled')),
  currency VARCHAR(10) NOT NULL CHECK (currency IN ('CDF', 'USD')),
  subtotal_cents BIGINT NOT NULL DEFAULT 0,
  total_cents BIGINT NOT NULL DEFAULT 0,
  payment_method VARCHAR(20) CHECK (payment_method IN ('cash', 'scanlinkpay')),
  payment_request_id UUID REFERENCES payment_requests(id), -- ScanLinkPay path only
  cancelled_reason TEXT,
  cancelled_by UUID REFERENCES auth.users(id),
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pos_ticket_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id UUID NOT NULL REFERENCES pos_tickets(id) ON DELETE CASCADE,
  stock_item_id UUID NOT NULL REFERENCES stock_items(id),
  product_name_snapshot VARCHAR(255) NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  unit_price_cents_snapshot BIGINT NOT NULL,
  line_total_cents BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cash_register_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  cashier_user_id UUID NOT NULL REFERENCES auth.users(id),
  currency VARCHAR(10) NOT NULL CHECK (currency IN ('CDF', 'USD')),
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opening_float_cents BIGINT NOT NULL CHECK (opening_float_cents >= 0),
  closing_counted_cents BIGINT,
  expected_cents BIGINT,
  discrepancy_cents BIGINT,
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

ALTER TABLE pos_tickets DROP CONSTRAINT IF EXISTS pos_tickets_cash_register_session_id_fkey;
ALTER TABLE pos_tickets ADD CONSTRAINT pos_tickets_cash_register_session_id_fkey
  FOREIGN KEY (cash_register_session_id) REFERENCES cash_register_sessions(id);

CREATE TABLE IF NOT EXISTS cash_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES cash_register_sessions(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('cash_in', 'cash_out')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  reason TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_tickets_merchant_id ON pos_tickets(merchant_id);
CREATE INDEX IF NOT EXISTS idx_pos_tickets_payment_request_id ON pos_tickets(payment_request_id);
CREATE INDEX IF NOT EXISTS idx_pos_ticket_items_ticket_id ON pos_ticket_items(ticket_id);
CREATE INDEX IF NOT EXISTS idx_cash_register_sessions_merchant_id ON cash_register_sessions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_session_id ON cash_movements(session_id);

-- Cashier PIN to unlock a shared till without a full email/password login —
-- deliberately separate from WalletPinService's profiles.transaction_pin_hash
-- (that one authorizes spending from the PIN owner's own wallet; this one is
-- "which employee is operating this physical register right now," a
-- different concept keyed on organization_staff instead of profiles).
ALTER TABLE organization_staff ADD COLUMN IF NOT EXISTS pos_pin_hash TEXT;
ALTER TABLE organization_staff ADD COLUMN IF NOT EXISTS pos_pin_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE organization_staff ADD COLUMN IF NOT EXISTS pos_pin_locked_until TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- RLS — defense in depth; the NestJS backend writes via the service-role
-- client (bypasses RLS) same as every other module. Reuses
-- public.is_stock_manager(merchant_id) from 031_stock_management.sql
-- (already covers: store owner, org owner, or any org-scoped staff role,
-- which includes 'caissier').
-- ----------------------------------------------------------------------------
ALTER TABLE pos_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pos_tickets_select ON pos_tickets;
CREATE POLICY pos_tickets_select ON pos_tickets FOR SELECT USING (public.is_stock_manager(pos_tickets.merchant_id));
DROP POLICY IF EXISTS pos_tickets_insert ON pos_tickets;
CREATE POLICY pos_tickets_insert ON pos_tickets FOR INSERT WITH CHECK (public.is_stock_manager(pos_tickets.merchant_id));
DROP POLICY IF EXISTS pos_tickets_update ON pos_tickets;
CREATE POLICY pos_tickets_update ON pos_tickets FOR UPDATE USING (public.is_stock_manager(pos_tickets.merchant_id));

ALTER TABLE pos_ticket_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pos_ticket_items_select ON pos_ticket_items;
CREATE POLICY pos_ticket_items_select ON pos_ticket_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM pos_tickets t WHERE t.id = pos_ticket_items.ticket_id AND public.is_stock_manager(t.merchant_id))
);
DROP POLICY IF EXISTS pos_ticket_items_insert ON pos_ticket_items;
CREATE POLICY pos_ticket_items_insert ON pos_ticket_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM pos_tickets t WHERE t.id = pos_ticket_items.ticket_id AND public.is_stock_manager(t.merchant_id))
);
DROP POLICY IF EXISTS pos_ticket_items_delete ON pos_ticket_items;
CREATE POLICY pos_ticket_items_delete ON pos_ticket_items FOR DELETE USING (
  EXISTS (SELECT 1 FROM pos_tickets t WHERE t.id = pos_ticket_items.ticket_id AND public.is_stock_manager(t.merchant_id))
);

ALTER TABLE cash_register_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cash_register_sessions_select ON cash_register_sessions;
CREATE POLICY cash_register_sessions_select ON cash_register_sessions FOR SELECT USING (public.is_stock_manager(cash_register_sessions.merchant_id));
DROP POLICY IF EXISTS cash_register_sessions_insert ON cash_register_sessions;
CREATE POLICY cash_register_sessions_insert ON cash_register_sessions FOR INSERT WITH CHECK (public.is_stock_manager(cash_register_sessions.merchant_id));
DROP POLICY IF EXISTS cash_register_sessions_update ON cash_register_sessions;
CREATE POLICY cash_register_sessions_update ON cash_register_sessions FOR UPDATE USING (public.is_stock_manager(cash_register_sessions.merchant_id));

ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cash_movements_select ON cash_movements;
CREATE POLICY cash_movements_select ON cash_movements FOR SELECT USING (
  EXISTS (SELECT 1 FROM cash_register_sessions s WHERE s.id = cash_movements.session_id AND public.is_stock_manager(s.merchant_id))
);
DROP POLICY IF EXISTS cash_movements_insert ON cash_movements;
CREATE POLICY cash_movements_insert ON cash_movements FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM cash_register_sessions s WHERE s.id = cash_movements.session_id AND public.is_stock_manager(s.merchant_id))
);
