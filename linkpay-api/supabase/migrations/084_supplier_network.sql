-- ============================================================================
-- 084_supplier_network.sql — Enterprises supply each other (DECISIONS.md 23/10, phase C). All sectors.
--
-- 1. supplier_profiles: an enterprise that "becomes a supplier" (its owner switches it on): a supplier number, the name
--    shown to its clients, the station its goods leave from, an optional default delivery fee.
-- 2. supplier_catalog_items: what it sells to other enterprises — products of that station's stock, at its own price
--    for businesses (the shelf price is not shown).
-- 3. supplier_links: a client enterprise invites a supplier by its number; the supplier accepts (or refuses). Once
--    accepted, the supplier also appears in the client's list of suppliers (suppliers.supplier_org_id, migration 083).
-- 4. supplier_orders / supplier_order_items: the client orders from the catalog → the supplier confirms and sets the
--    delivery fee of THIS order (distance varies) → payment (ScanLinkPay through a payment request, or cash / Mobile
--    Money outside the app, confirmed by the supplier) → the supplier validates the delivery (its stock goes out) →
--    the client confirms reception (its stock comes in, the purchase price is updated).
--
-- 5. The "Fournisseur" plan (paid by the supplier): a free trial, then a monthly price, or a year for (12 − N) months.
--    The super admin sets the trial length, the prices (CDF / USD) and N (supplier_plan_settings / _prices). The owner
--    pays from their ScanLinkPay wallet with their PIN (purchase_supplier_plan, same pattern as purchase_subscription).
--    Without a running plan (trial over, not paid) a supplier takes no new order nor invitation.
--
-- An order's money never moves here: a ScanLinkPay payment goes through the usual payment request (payment_requests),
-- with the usual rules (ledger, commission). Stock moves only through stock_movements.
--
-- Run in the Supabase SQL editor (LinkPay Test first, then production), after 083.
-- ============================================================================

CREATE TABLE IF NOT EXISTS supplier_profiles (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_number VARCHAR(20) NOT NULL UNIQUE,
  display_name VARCHAR(120) NOT NULL CHECK (length(btrim(display_name)) > 0),
  phone VARCHAR(30),
  address VARCHAR(255),
  delivery_zone VARCHAR(255),
  description TEXT CHECK (description IS NULL OR length(description) <= 1000),
  -- The station the goods leave from: its stock is the catalog, and it receives ScanLinkPay payments.
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
  default_delivery_fee_cents BIGINT CHECK (default_delivery_fee_cents IS NULL OR default_delivery_fee_cents >= 0),
  default_delivery_currency VARCHAR(3) CHECK (default_delivery_currency IS NULL OR default_delivery_currency IN ('CDF', 'USD')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  -- The plan: the trial is fixed when the owner becomes a supplier (a later change of the trial length by the super
  -- admin only applies to new suppliers); plan_expires_at is NULL until the first payment.
  trial_ends_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  plan_expires_at TIMESTAMPTZ,
  -- Smallest reminder threshold already sent (0 = "ended" notice sent), for the trial and for the paid plan.
  trial_last_reminder_days INT,
  plan_last_reminder_days INT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_catalog_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  stock_item_id UUID NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
  price_cents BIGINT NOT NULL CHECK (price_cents > 0),
  currency VARCHAR(3) NOT NULL CHECK (currency IN ('CDF', 'USD')),
  min_quantity INT NOT NULL DEFAULT 1 CHECK (min_quantity >= 1),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (supplier_org_id, stock_item_id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_catalog_org ON supplier_catalog_items(supplier_org_id) WHERE active;

CREATE TABLE IF NOT EXISTS supplier_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'refused', 'ended')),
  message TEXT CHECK (message IS NULL OR length(message) <= 500),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (client_org_id <> supplier_org_id),
  UNIQUE (client_org_id, supplier_org_id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_links_supplier ON supplier_links(supplier_org_id, status);

CREATE TABLE IF NOT EXISTS supplier_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  number VARCHAR(20) NOT NULL UNIQUE,
  client_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  supplier_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  status VARCHAR(12) NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'confirmed', 'paid', 'delivered', 'received', 'refused', 'cancelled')),
  currency VARCHAR(3) NOT NULL CHECK (currency IN ('CDF', 'USD')),
  subtotal_cents BIGINT NOT NULL CHECK (subtotal_cents > 0),
  delivery_requested BOOLEAN NOT NULL DEFAULT FALSE,
  delivery_address VARCHAR(255),
  delivery_fee_cents BIGINT NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0),
  total_cents BIGINT NOT NULL CHECK (total_cents > 0),
  note TEXT CHECK (note IS NULL OR length(note) <= 500),
  supplier_note TEXT CHECK (supplier_note IS NULL OR length(supplier_note) <= 500),
  -- 'scanlinkpay' (paid through payment_request_id) or 'cash' / 'mobile_money' (outside the app, confirmed by the supplier)
  payment_method VARCHAR(12) CHECK (payment_method IS NULL OR payment_method IN ('scanlinkpay', 'cash', 'mobile_money')),
  payment_reference VARCHAR(100),
  client_declared_payment_at TIMESTAMPTZ,
  payment_request_id UUID REFERENCES payment_requests(id) ON DELETE SET NULL,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  ordered_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  paid_confirmed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  paid_at TIMESTAMPTZ,
  delivered_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  delivered_at TIMESTAMPTZ,
  received_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ,
  closed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_supplier_orders_client ON supplier_orders(client_org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_orders_supplier ON supplier_orders(supplier_org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_orders_request ON supplier_orders(payment_request_id) WHERE payment_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS supplier_order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES supplier_orders(id) ON DELETE CASCADE,
  catalog_item_id UUID REFERENCES supplier_catalog_items(id) ON DELETE SET NULL,
  supplier_stock_item_id UUID REFERENCES stock_items(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  barcode VARCHAR(64),
  category VARCHAR(100),
  quantity INT NOT NULL CHECK (quantity > 0),
  unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents > 0),
  -- The client's product the goods went into (found by barcode, picked, or created at reception).
  client_stock_item_id UUID REFERENCES stock_items(id) ON DELETE SET NULL,
  -- Movement references (stock_movements.client_ref): a delivery or a reception sent twice moves the stock once.
  out_ref UUID NOT NULL DEFAULT uuid_generate_v4(),
  in_ref UUID NOT NULL DEFAULT uuid_generate_v4()
);
CREATE INDEX IF NOT EXISTS idx_supplier_order_items_order ON supplier_order_items(order_id);

-- Only the API (service role) reads and writes them; access is checked there.
ALTER TABLE supplier_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_order_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON supplier_profiles, supplier_catalog_items, supplier_links, supplier_orders, supplier_order_items FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- The "Fournisseur" plan
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_plan_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  trial_days INT NOT NULL DEFAULT 30 CHECK (trial_days BETWEEN 0 AND 365),
  -- The year costs (12 − annual_free_months) months.
  annual_free_months INT NOT NULL DEFAULT 2 CHECK (annual_free_months BETWEEN 0 AND 11),
  reminder_days INT[] NOT NULL DEFAULT '{7,3,1}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id)
);
INSERT INTO supplier_plan_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS supplier_plan_prices (
  currency VARCHAR(10) PRIMARY KEY CHECK (currency IN ('CDF', 'USD')),
  price_month_cents BIGINT NOT NULL CHECK (price_month_cents > 0)
);
-- Starting price agreed on 23/10: 10 USD a month. The CDF price is left to the super admin (exchange rate).
INSERT INTO supplier_plan_prices (currency, price_month_cents) VALUES ('USD', 1000) ON CONFLICT (currency) DO NOTHING;

CREATE TABLE IF NOT EXISTS supplier_plan_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  purchased_by UUID NOT NULL REFERENCES auth.users(id),
  plan VARCHAR(10) NOT NULL CHECK (plan IN ('monthly', 'annual')),
  months INT NOT NULL CHECK (months > 0),
  months_charged INT NOT NULL CHECK (months_charged > 0 AND months_charged <= months),
  currency VARCHAR(10) NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  reference TEXT NOT NULL UNIQUE,
  starts_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_supplier_plan_purchases_org ON supplier_plan_purchases(organization_id, created_at DESC);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['supplier_plan_settings', 'supplier_plan_prices', 'supplier_plan_purchases']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON %I TO service_role', t);
  END LOOP;
END $$;

-- Debit the owner's wallet, record the payment, extend the plan — in one transaction, idempotent on its reference.
-- The amount is computed by the API from the super admin's prices; this function checks who pays and moves the money.
CREATE OR REPLACE FUNCTION public.purchase_supplier_plan(
  p_org UUID,
  p_user UUID,
  p_wallet UUID,
  p_plan VARCHAR,
  p_months INT,
  p_months_charged INT,
  p_currency VARCHAR,
  p_amount BIGINT,
  p_reference TEXT
) RETURNS TABLE (expires_at TIMESTAMPTZ)
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing supplier_plan_purchases;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
BEGIN
  IF p_plan NOT IN ('monthly', 'annual') THEN RAISE EXCEPTION 'SUPPLIER_PLAN_INVALID'; END IF;
  IF p_months < 1 OR p_months > 24 OR p_months_charged < 1 OR p_months_charged > p_months THEN RAISE EXCEPTION 'SUPPLIER_PLAN_INVALID_MONTHS'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'SUPPLIER_PLAN_INVALID_AMOUNT'; END IF;

  -- Only the owner of the business, paying from their own wallet.
  PERFORM 1 FROM organizations WHERE id = p_org AND owner_id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_PLAN_NOT_OWNER'; END IF;
  PERFORM 1 FROM wallets WHERE id = p_wallet AND user_id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'WALLET_USER_MISMATCH'; END IF;

  -- One payment at a time per supplier (months stack), and a same-reference retry waits for the first one.
  SELECT GREATEST(COALESCE(sp.plan_expires_at, NOW()), sp.trial_ends_at, NOW()) INTO v_start
    FROM supplier_profiles sp WHERE sp.organization_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_PLAN_NOT_SUPPLIER'; END IF;

  SELECT * INTO v_existing FROM supplier_plan_purchases WHERE reference = p_reference;
  IF FOUND THEN
    IF v_existing.organization_id <> p_org THEN RAISE EXCEPTION 'SUPPLIER_PLAN_REFERENCE_CONFLICT'; END IF;
    RETURN QUERY SELECT v_existing.expires_at;
    RETURN;
  END IF;
  v_end := v_start + make_interval(months => p_months);

  -- Raises 'Insufficient balance' when the wallet doesn't hold enough.
  PERFORM debit_wallet(p_wallet, p_amount, 'SUBSCRIPTION', 'SUPPLIER-PLAN-' || p_reference, p_currency,
    jsonb_build_object('organization_id', p_org, 'plan', p_plan, 'months', p_months, 'supplier_plan', true));

  INSERT INTO supplier_plan_purchases (organization_id, purchased_by, plan, months, months_charged, currency, amount_cents, reference, starts_at, expires_at)
  VALUES (p_org, p_user, p_plan, p_months, p_months_charged, p_currency, p_amount, p_reference, v_start, v_end);

  UPDATE supplier_profiles sp
     SET plan_expires_at = v_end, plan_last_reminder_days = NULL, updated_at = NOW()
   WHERE sp.organization_id = p_org;

  RETURN QUERY SELECT v_end;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.purchase_supplier_plan(UUID, UUID, UUID, VARCHAR, INT, INT, VARCHAR, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_supplier_plan(UUID, UUID, UUID, VARCHAR, INT, INT, VARCHAR, BIGINT, TEXT) TO service_role;

-- What the platform earned from the Fournisseur plan, per currency (super admin screen).
CREATE OR REPLACE FUNCTION public.supplier_plan_revenue()
RETURNS TABLE (currency VARCHAR, total_cents BIGINT, purchases BIGINT)
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT currency, SUM(amount_cents)::BIGINT, COUNT(*)::BIGINT FROM supplier_plan_purchases GROUP BY currency
$$ LANGUAGE sql STABLE;
REVOKE ALL ON FUNCTION public.supplier_plan_revenue() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supplier_plan_revenue() TO service_role;

-- The treasury (079) counts the Fournisseur plan with the subscriptions: same function, one more sum.
CREATE OR REPLACE FUNCTION public.treasury_overview()
RETURNS TABLE (
  currency VARCHAR,
  owed_wallets BIGINT,          -- every positive wallet balance (what each account could withdraw)
  owed_savings BIGINT,          -- money put aside in savings pots
  pending_withdrawals BIGINT,   -- debited from a wallet, not sent yet
  uncredited_payments BIGINT,   -- paid to a shop, not credited to its wallet yet (the retry job does it)
  negative_wallets INT,         -- wallets below zero: an anomaly to look at
  subscriptions BIGINT,         -- earned: business subscriptions + the Fournisseur plan (084)
  commissions BIGINT,           -- earned: ScanLinkPay's commission on payments
  withdrawal_fees BIGINT,       -- earned: fees on withdrawals sent
  transfer_fees BIGINT,         -- earned: fees on transfers
  pro_payments BIGINT           -- earned: "Mes dépenses" Pro plan (paid by Mobile Money)
)
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cur(c) AS (VALUES ('CDF'::varchar), ('USD'::varchar)),
  real_wallets AS (SELECT id, user_id FROM wallets WHERE NOT is_test),
  bal AS (
    SELECT le.currency, le.wallet_id,
           SUM(CASE WHEN le.direction = 'credit' THEN le.amount_cents ELSE -le.amount_cents END) AS b
      FROM ledger_entries le JOIN real_wallets w ON w.id = le.wallet_id
     GROUP BY le.currency, le.wallet_id
  )
  SELECT cur.c,
    COALESCE((SELECT SUM(b) FROM bal WHERE bal.currency = cur.c AND b > 0), 0)::BIGINT,
    COALESCE((SELECT SUM(CASE WHEN e.type = 'round_up' THEN e.amount_cents ELSE -e.amount_cents END)
                FROM savings_pot_entries e JOIN savings_pots p ON p.id = e.pot_id
               WHERE p.currency = cur.c AND p.user_id IN (SELECT user_id FROM real_wallets)), 0)::BIGINT,
    COALESCE((SELECT SUM(wd.amount_cents) FROM withdrawals wd JOIN real_wallets w ON w.id = wd.wallet_id
               WHERE wd.currency = cur.c AND wd.status IN ('PENDING', 'PROCESSING')), 0)::BIGINT,
    COALESCE((SELECT SUM(t.net_cents) FROM transactions t
               WHERE t.currency = cur.c AND t.status IN ('SUCCESS', 'PARTIALLY_REFUNDED') AND t.wallet_credited_at IS NULL), 0)::BIGINT,
    (SELECT COUNT(*) FROM bal WHERE bal.currency = cur.c AND b < 0)::INT,
    (COALESCE((SELECT SUM(sp.amount_cents) FROM subscription_purchases sp
               WHERE sp.currency = cur.c AND sp.purchased_by IN (SELECT user_id FROM real_wallets)), 0)
     + COALESCE((SELECT SUM(fp.amount_cents) FROM supplier_plan_purchases fp
               WHERE fp.currency = cur.c AND fp.purchased_by IN (SELECT user_id FROM real_wallets)), 0))::BIGINT,
    COALESCE((SELECT SUM(t.platform_fee_cents) FROM transactions t
               WHERE t.currency = cur.c AND t.status IN ('SUCCESS', 'PARTIALLY_REFUNDED')), 0)::BIGINT,
    COALESCE((SELECT SUM(wd.fee_cents) FROM withdrawals wd JOIN real_wallets w ON w.id = wd.wallet_id
               WHERE wd.currency = cur.c AND wd.status = 'SUCCESS'), 0)::BIGINT,
    COALESCE((SELECT SUM(tr.fee_cents) FROM transfers tr JOIN real_wallets w ON w.id = tr.sender_wallet_id
               WHERE tr.currency = cur.c AND tr.status = 'SUCCESS'), 0)::BIGINT,
    COALESCE((SELECT SUM(pp.amount_cents) FROM expense_pro_payments pp
               WHERE pp.currency = cur.c AND pp.status = 'SUCCESS'), 0)::BIGINT
  FROM cur
$$ LANGUAGE sql STABLE;

REVOKE ALL ON FUNCTION public.treasury_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.treasury_overview() TO service_role;
