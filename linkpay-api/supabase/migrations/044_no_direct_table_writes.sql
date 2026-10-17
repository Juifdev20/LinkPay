-- ============================================================================
-- 044_no_direct_table_writes.sql — Only the API writes to the database.
--
-- THE PROBLEM. Every signed-in user holds a real Supabase JWT (the login
-- response hands it to the web app for Realtime) and the anon key is public,
-- so anyone can talk to PostgREST directly and use whatever the row-level-
-- security policies allow. Several policies allow far too much for a
-- direct, unvalidated write:
--   - user_roles    INSERT own row, any role_id   (grant yourself super_admin)
--   - merchants     UPDATE own row                (status, commission_rule_id)
--   - organizations UPDATE / INSERT own row       (status: skip admin approval)
--   - profiles      UPDATE own row                (pin_attempts, pin_locked_until,
--                   transaction_pin_hash, active_session_id, two_factor_*: reset
--                   the PIN lockout, replace the PIN, drop the single-session lock)
--   - pos_ticket_payments / cash_register_sessions / stock_items ... UPDATE by
--     any store staff (a cashier could mark a pending payment as paid)
-- The API enforces rules on every one of these writes (allowed fields, roles,
-- limits); a direct write skips all of it.
--
-- THE FIX. The web app never writes to a table itself — it only reads and
-- subscribes to Realtime — and the API uses the service_role key. So write
-- privileges on every table are simply taken away from anon and authenticated.
-- Reads (still filtered by RLS) and Realtime are untouched. Future tables are
-- covered by the default privileges below.
--
-- Run once in the Supabase SQL editor — as soon as possible.
-- ============================================================================

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE USAGE, UPDATE ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE, UPDATE ON SEQUENCES FROM anon, authenticated;
