-- 079 — Trésorerie: what ScanLinkPay may take out of its FlexPaie account without touching anybody's money.
--
-- The real money sits on ScanLinkPay's FlexPaie merchant account. Part of it belongs to the users: every balance
-- (wallets, savings), every withdrawal debited but not sent yet, every payment received for a shop and not yet
-- credited to it. What is left is ScanLinkPay's own money (subscriptions, commissions, fees).
-- treasury_overview() computes, per currency, what is owed and what was earned (test wallets left out);
-- treasury_balances keeps the FlexPaie balance the super admin reads in the FlexPaie dashboard and types in (no
-- FlexPaie API is used for it). The page subtracts one from the other. Re-runnable.

CREATE TABLE IF NOT EXISTS treasury_balances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  currency VARCHAR(3) NOT NULL CHECK (currency IN ('CDF', 'USD')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  note TEXT,
  noted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  noted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS treasury_balances_latest ON treasury_balances (currency, noted_at DESC);
ALTER TABLE treasury_balances ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.treasury_overview()
RETURNS TABLE (
  currency VARCHAR,
  owed_wallets BIGINT,          -- every positive wallet balance (what each account could withdraw)
  owed_savings BIGINT,          -- money put aside in savings pots
  pending_withdrawals BIGINT,   -- debited from a wallet, not sent yet
  uncredited_payments BIGINT,   -- paid to a shop, not credited to its wallet yet (the retry job does it)
  negative_wallets INT,         -- wallets below zero: an anomaly to look at
  subscriptions BIGINT,         -- earned: business subscriptions
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
    COALESCE((SELECT SUM(sp.amount_cents) FROM subscription_purchases sp
               WHERE sp.currency = cur.c AND sp.purchased_by IN (SELECT user_id FROM real_wallets)), 0)::BIGINT,
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
