-- ============================================================================
-- 043_lock_down_functions.sql — Only the API may run the database functions.
--
-- THE PROBLEM. Supabase hands EXECUTE on every new function in the public
-- schema to the roles `anon` and `authenticated` (via default privileges).
-- Earlier migrations only ran `REVOKE ALL ... FROM PUBLIC`, which does NOT
-- take those role-specific grants away. The `anon` key is public — it ships
-- in the web app — so anyone could call, straight over the REST API,
--   POST /rest/v1/rpc/credit_wallet   {wallet, amount, ...}
-- and add money to any wallet (and debit_wallet, transfer_wallet,
-- finish_withdrawal, ... likewise). Confirmed against a live project: the
-- call ran and only failed because the wallet id it was given didn't exist.
--
-- THE FIX. Every function of the public schema is revoked from PUBLIC, anon
-- and authenticated and granted to service_role only (the key the API uses,
-- never sent to a browser). Left alone:
--   - functions that belong to an extension (pgcrypto, uuid-ossp, ...);
--   - the five small helpers that row-level-security policies call while
--     evaluating a request as the signed-in user (is_admin, is_merchant_user,
--     is_org_owner_of_merchant, is_stock_manager, is_tontine_member): they only
--     answer a yes/no question about the caller and write nothing.
-- The manual-settlement function switched off in 041 stays off for everyone.
--
-- Default privileges are changed too, so functions added by FUTURE migrations
-- are not exposed again. Consequence: a future function that an RLS policy
-- needs must be granted to `authenticated` explicitly.
--
-- Run once in the Supabase SQL editor — as soon as possible.
-- ============================================================================

DO $$
DECLARE
  f RECORD;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
       AND p.proname NOT IN (
         'is_admin', 'is_merchant_user', 'is_org_owner_of_merchant', 'is_stock_manager', 'is_tontine_member'
       )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    IF f.proname = 'create_merchant_settlements' THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM service_role', f.sig);
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
    END IF;
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
