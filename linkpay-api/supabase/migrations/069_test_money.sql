-- ============================================================================
-- 069_test_money.sql — No fictitious money through the app; test money only from the SQL editor, and fenced in.
--
-- The app no longer has any simulated payment provider: every top-up, payment, subscription and withdrawal is
-- real money. For tests, the developers write test money directly here (docs/RECHARGE_TEST.md):
--
--   SELECT credit_test_money('243812345678', 10000, 'CDF');   -- 10 000 CDF on that account
--   SELECT remove_test_money('243812345678', 'CDF');          -- takes all the test CDF back
--
-- The wallet is then marked is_test. Test money must never become real money, so:
--   - a test wallet can NEVER withdraw (trigger on withdrawals);
--   - a test wallet can transfer only to another test wallet (trigger on transfers);
--   - the API also refuses a wallet payment or a merchant refund from a test wallet to a real one
--     (src/common/test-money.ts);
--   - a wallet stays marked as long as it holds money (it cannot be "unmarked" with a balance).
--
-- The two functions can be run ONLY from the Supabase SQL editor (owner role): not by the API, not by any user.
-- Run once in the Supabase SQL editor (after 068), BEFORE deploying the API version that reads wallets.is_test.
-- ============================================================================

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

-- Balance of one wallet in one currency (the ledger is the source of truth).
CREATE OR REPLACE FUNCTION public.wallet_balance_cents(p_wallet UUID, p_currency TEXT)
RETURNS BIGINT
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END), 0)::BIGINT
    FROM ledger_entries WHERE wallet_id = p_wallet AND currency = p_currency;
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------------- the fence

CREATE OR REPLACE FUNCTION public.forbid_test_wallet_withdrawal()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM wallets WHERE id = NEW.wallet_id AND is_test) THEN
    RAISE EXCEPTION 'TEST_WALLET_WITHDRAWAL: test money cannot leave ScanLinkPay';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_forbid_test_wallet_withdrawal ON withdrawals;
CREATE TRIGGER trg_forbid_test_wallet_withdrawal
  BEFORE INSERT ON withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.forbid_test_wallet_withdrawal();

CREATE OR REPLACE FUNCTION public.forbid_test_money_to_real_wallet()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A transfer paid by Mobile Money (psp_provider set) is real money, whoever sends it.
  IF NEW.sender_wallet_id IS NOT NULL AND NEW.psp_provider IS NULL
     AND EXISTS (SELECT 1 FROM wallets WHERE id = NEW.sender_wallet_id AND is_test)
     AND NOT EXISTS (SELECT 1 FROM wallets WHERE id = NEW.recipient_wallet_id AND is_test) THEN
    RAISE EXCEPTION 'TEST_MONEY_TO_REAL_WALLET: test money can only go to another test wallet';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_forbid_test_money_to_real_wallet ON transfers;
CREATE TRIGGER trg_forbid_test_money_to_real_wallet
  BEFORE INSERT ON transfers
  FOR EACH ROW EXECUTE FUNCTION public.forbid_test_money_to_real_wallet();

-- A test wallet stays a test wallet while it holds money (no "unmarking" to launder test money).
CREATE OR REPLACE FUNCTION public.keep_test_wallet_marked()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.is_test AND NOT NEW.is_test
     AND (wallet_balance_cents(OLD.id, 'CDF') <> 0 OR wallet_balance_cents(OLD.id, 'USD') <> 0) THEN
    RAISE EXCEPTION 'TEST_WALLET_NOT_EMPTY: take the test money back first (remove_test_money)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_keep_test_wallet_marked ON wallets;
CREATE TRIGGER trg_keep_test_wallet_marked
  BEFORE UPDATE OF is_test ON wallets
  FOR EACH ROW EXECUTE FUNCTION public.keep_test_wallet_marked();

-- ---------------------------------------------------------------------------- for the developers (SQL editor)

-- The account is found by its phone number (any form: +243 81…, 081…, 24381…).
CREATE OR REPLACE FUNCTION public.test_wallet_of(p_phone TEXT)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digits TEXT := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  v_user UUID;
  v_wallet UUID;
BEGIN
  IF v_digits LIKE '00%' THEN v_digits := substr(v_digits, 3); END IF;
  IF length(v_digits) = 10 AND v_digits LIKE '0%' THEN v_digits := '243' || substr(v_digits, 2); END IF;
  IF length(v_digits) = 9 THEN v_digits := '243' || v_digits; END IF;

  SELECT id INTO v_user FROM profiles WHERE regexp_replace(COALESCE(phone, ''), '\D', '', 'g') = v_digits LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'No account with the phone number %', p_phone; END IF;
  SELECT id INTO v_wallet FROM wallets WHERE user_id = v_user;
  IF v_wallet IS NULL THEN RAISE EXCEPTION 'This account has no wallet yet: open the wallet in the app first'; END IF;
  RETURN v_wallet;
END;
$$ LANGUAGE plpgsql;

-- p_amount in units (10000 = 10 000 CDF, 25 = 25 USD).
CREATE OR REPLACE FUNCTION public.credit_test_money(p_phone TEXT, p_amount NUMERIC, p_currency TEXT DEFAULT 'CDF')
RETURNS TEXT
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet UUID := test_wallet_of(p_phone);
  v_cents BIGINT := round(p_amount * 100);
  v_balance BIGINT;
BEGIN
  IF v_cents <= 0 THEN RAISE EXCEPTION 'The amount must be positive'; END IF;
  UPDATE wallets SET is_test = true WHERE id = v_wallet AND NOT is_test;
  v_balance := credit_wallet(v_wallet, v_cents, 'ADJUSTMENT', 'TEST-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
    upper(p_currency), jsonb_build_object('source', 'test-money', 'by', current_user));
  RETURN format('Test wallet credited: %s %s (balance %s %s). It can no longer withdraw or send money to a real wallet.',
    p_amount, upper(p_currency), round(v_balance / 100.0, 2), upper(p_currency));
END;
$$ LANGUAGE plpgsql;

-- Takes ALL the money of one currency back from a test wallet.
CREATE OR REPLACE FUNCTION public.remove_test_money(p_phone TEXT, p_currency TEXT DEFAULT 'CDF')
RETURNS TEXT
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet UUID := test_wallet_of(p_phone);
  v_balance BIGINT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM wallets WHERE id = v_wallet AND is_test) THEN
    RAISE EXCEPTION 'This wallet is not a test wallet: its money is real and is not touched';
  END IF;
  v_balance := wallet_balance_cents(v_wallet, upper(p_currency));
  IF v_balance > 0 THEN
    PERFORM debit_wallet(v_wallet, v_balance, 'ADJUSTMENT', 'TEST-REMOVE-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
      upper(p_currency), jsonb_build_object('source', 'test-money', 'by', current_user));
  END IF;
  RETURN format('%s %s of test money removed.', round(v_balance / 100.0, 2), upper(p_currency));
END;
$$ LANGUAGE plpgsql;

-- Nobody but the database owner (the SQL editor) may call these: not the API (service_role), not a user.
REVOKE ALL ON FUNCTION public.test_wallet_of(TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.credit_test_money(TEXT, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.remove_test_money(TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.wallet_balance_cents(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.forbid_test_wallet_withdrawal() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.forbid_test_money_to_real_wallet() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.keep_test_wallet_marked() FROM PUBLIC;
