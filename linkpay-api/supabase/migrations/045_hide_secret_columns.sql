-- ============================================================================
-- 045_hide_secret_columns.sql — Secret columns can't be read through the REST
-- API, not even by their owner.
--
-- A user may read their own row of `profiles` (and an enterprise owner their
-- own row of `organizations`) — RLS allows it — and those rows hold
-- credentials: the transaction PIN hash, the 2FA secret, PIN attempt/lock
-- counters, the single-session columns, the stock-management password hash.
-- A bcrypt hash of a 4-digit PIN is guessed offline in seconds, so anyone
-- holding a stolen session could read the hash and recover the PIN. Only the
-- API (service_role) ever needs those columns.
--
-- Column privileges only bite when the table-level SELECT is removed first,
-- so SELECT is revoked from anon/authenticated and granted back column by
-- column, minus the secrets. The web app never queries these tables itself
-- and Realtime isn't subscribed to them. A column added to these tables later
-- is therefore hidden until it is granted explicitly (fail closed).
--
-- Run once in the Supabase SQL editor, after 043 and 044.
-- ============================================================================

DO $$
DECLARE
  spec RECORD;
  readable TEXT;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('profiles', ARRAY['transaction_pin_hash', 'pin_attempts', 'pin_locked_until', 'two_factor_secret', 'active_session_id', 'active_device_id']),
      ('organizations', ARRAY['stock_password_hash', 'stock_password_attempts', 'stock_password_locked_until'])
    ) AS t(tbl, secrets)
  LOOP
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
      INTO readable
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = spec.tbl AND NOT (column_name = ANY (spec.secrets));

    EXECUTE format('REVOKE SELECT ON public.%I FROM anon, authenticated', spec.tbl);
    EXECUTE format('GRANT SELECT (%s) ON public.%I TO authenticated', readable, spec.tbl);
  END LOOP;
END $$;
