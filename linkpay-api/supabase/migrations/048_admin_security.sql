-- ============================================================================
-- 048_admin_security.sql — Two-factor login for administrators + integrity
-- monitoring.
--
-- 1. profiles gets the bookkeeping the authenticator-app (TOTP) login needs:
--    the last accepted time step (a code can only be used once), hashed
--    one-time recovery codes, and when 2FA was set up. profiles.two_factor_secret
--    and two_factor_enabled already exist (001); the secret is stored
--    ENCRYPTED by the API. Like the other secret columns these are never
--    readable through the public REST API.
--
-- 2. claim_totp_step / consume_recovery_code: single atomic statements, so
--    two simultaneous requests can't both spend the same code.
--
-- 3. negative_wallet_balances(): any wallet whose ledger sums below zero means
--    money was created or a bug let a wallet overdraw. The API checks it every
--    10 minutes and alerts the super admins.
--
-- Run once in the Supabase SQL editor (after 047).
-- ============================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS two_factor_last_step BIGINT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS two_factor_recovery_hashes TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS two_factor_enrolled_at TIMESTAMPTZ;

-- Same technique as 045: table-level SELECT is withdrawn and every column
-- EXCEPT the secrets is granted back, so the new columns stay unreadable.
DO $$
DECLARE
  readable TEXT;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO readable
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'profiles'
     AND column_name NOT IN (
       'transaction_pin_hash', 'pin_attempts', 'pin_locked_until', 'two_factor_secret',
       'active_session_id', 'active_device_id', 'two_factor_last_step', 'two_factor_recovery_hashes'
     );
  REVOKE SELECT ON public.profiles FROM anon, authenticated;
  EXECUTE format('GRANT SELECT (%s) ON public.profiles TO authenticated', readable);
END $$;

CREATE OR REPLACE FUNCTION public.claim_totp_step(p_user_id UUID, p_step BIGINT)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INT;
BEGIN
  UPDATE profiles
     SET two_factor_last_step = p_step
   WHERE id = p_user_id
     AND (two_factor_last_step IS NULL OR two_factor_last_step < p_step);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.consume_recovery_code(p_user_id UUID, p_hash TEXT)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INT;
BEGIN
  UPDATE profiles
     SET two_factor_recovery_hashes = array_remove(two_factor_recovery_hashes, p_hash)
   WHERE id = p_user_id AND p_hash = ANY(two_factor_recovery_hashes);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.negative_wallet_balances()
RETURNS TABLE (wallet_id UUID, currency VARCHAR, balance_cents BIGINT)
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.wallet_id, l.currency,
         SUM(CASE WHEN l.direction = 'credit' THEN l.amount_cents ELSE -l.amount_cents END)::BIGINT AS balance_cents
    FROM ledger_entries l
   WHERE l.wallet_id IS NOT NULL
   GROUP BY l.wallet_id, l.currency
  HAVING SUM(CASE WHEN l.direction = 'credit' THEN l.amount_cents ELSE -l.amount_cents END) < 0
$$ LANGUAGE sql STABLE;

REVOKE ALL ON FUNCTION public.claim_totp_step(UUID, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_recovery_code(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.negative_wallet_balances() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_totp_step(UUID, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_recovery_code(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.negative_wallet_balances() TO service_role;
