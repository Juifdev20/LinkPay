-- ============================================================================
-- 071_platform_environment.sql — Each database says whether it is PRODUCTION or TEST, for good.
--
-- Two Supabase projects: "LinkPay" (production, real customers, real money) and "LinkPay Test" (developers,
-- test money only). This one-row table says which one a database is, and can never be changed afterwards:
--   - production: test money is impossible (credit_test_money refuses);
--   - test: the API refuses every real payment (no FlexPaie money can land in a test database), and test money
--     is written with credit_test_money (docs/BASE_TEST.md).
--
-- Run in the production SQL editor as usual: with nothing else said, the database is marked PRODUCTION.
-- The test database is built with supabase/base_complete.sql, which says TEST before this migration runs.
-- ============================================================================

CREATE TABLE IF NOT EXISTS platform_environment (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  name TEXT NOT NULL CHECK (name IN ('production', 'test')),
  marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO platform_environment (name)
VALUES (CASE WHEN current_setting('linkpay.environment', true) = 'test' THEN 'test' ELSE 'production' END)
ON CONFLICT (singleton) DO NOTHING;

-- Marked once, never changed: a production database can never be turned into a "test" one to mint money.
CREATE OR REPLACE FUNCTION public.platform_environment_is_final()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'PLATFORM_ENVIRONMENT_FINAL: this database is % for good', OLD.name;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_platform_environment_final ON platform_environment;
CREATE TRIGGER trg_platform_environment_final
  BEFORE UPDATE OR DELETE ON platform_environment
  FOR EACH ROW EXECUTE FUNCTION public.platform_environment_is_final();

ALTER TABLE platform_environment ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform_environment FROM PUBLIC, anon, authenticated;
GRANT SELECT ON platform_environment TO service_role;
REVOKE ALL ON FUNCTION public.platform_environment_is_final() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.is_test_database()
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT name = 'test' FROM platform_environment), false);
$$ LANGUAGE sql STABLE;
REVOKE ALL ON FUNCTION public.is_test_database() FROM PUBLIC, anon, authenticated;

-- Test money exists only in the test database (replaces 069's version, same signature).
CREATE OR REPLACE FUNCTION public.credit_test_money(p_phone TEXT, p_amount NUMERIC, p_currency TEXT DEFAULT 'CDF')
RETURNS TEXT
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet UUID;
  v_cents BIGINT := round(p_amount * 100);
  v_balance BIGINT;
BEGIN
  IF NOT is_test_database() THEN
    RAISE EXCEPTION 'TEST_MONEY_PRODUCTION: this is the PRODUCTION database — test money only exists in LinkPay Test';
  END IF;
  v_wallet := test_wallet_of(p_phone);
  IF v_cents <= 0 THEN RAISE EXCEPTION 'The amount must be positive'; END IF;
  UPDATE wallets SET is_test = true WHERE id = v_wallet AND NOT is_test;
  v_balance := credit_wallet(v_wallet, v_cents, 'ADJUSTMENT', 'TEST-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
    upper(p_currency), jsonb_build_object('source', 'test-money', 'by', current_user));
  RETURN format('Test wallet credited: %s %s (balance %s %s). It can no longer withdraw or send money to a real wallet.',
    p_amount, upper(p_currency), round(v_balance / 100.0, 2), upper(p_currency));
END;
$$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION public.credit_test_money(TEXT, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated, service_role;
