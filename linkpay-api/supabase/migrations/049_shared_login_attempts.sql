-- ============================================================================
-- 049_shared_login_attempts.sql — Login / 2FA lockout counters shared by every
-- API instance.
--
-- Until now the failed-attempt counters lived in each API process's memory: two
-- instances gave an attacker two budgets, and a restart wiped the count.
-- record_auth_failure() keeps them in the database instead, atomically (the row
-- is locked while it is updated, so concurrent guesses can't slip past the
-- limit). The API falls back to its in-memory counters if this table or
-- function is unavailable, so applying this migration is not a prerequisite
-- for deploying.
--
-- `key` is a SHA-256 of the account (email or user id), never the email itself.
-- Only the API (service_role) can touch it.
-- Run once in the Supabase SQL editor (after 048).
-- ============================================================================

CREATE TABLE IF NOT EXISTS auth_attempts (
  key TEXT PRIMARY KEY,
  failures INT NOT NULL DEFAULT 0,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until TIMESTAMPTZ
);

ALTER TABLE auth_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON auth_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON auth_attempts TO service_role;

-- Records one failure. Returns when the account is locked until (NULL = not
-- locked) and whether THIS failure is the one that triggered the lock.
CREATE OR REPLACE FUNCTION public.record_auth_failure(
  p_key TEXT,
  p_max INT,
  p_window_seconds INT,
  p_lock_seconds INT
) RETURNS TABLE (locked_until TIMESTAMPTZ, just_locked BOOLEAN)
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_row auth_attempts;
BEGIN
  INSERT INTO auth_attempts (key, failures, window_started_at) VALUES (p_key, 0, v_now)
  ON CONFLICT (key) DO NOTHING;

  SELECT * INTO v_row FROM auth_attempts WHERE key = p_key FOR UPDATE;

  IF v_row.locked_until IS NOT NULL AND v_row.locked_until > v_now THEN
    RETURN QUERY SELECT v_row.locked_until, FALSE;
    RETURN;
  END IF;

  IF v_row.window_started_at < v_now - make_interval(secs => p_window_seconds) THEN
    v_row.failures := 0;
    v_row.window_started_at := v_now;
  END IF;

  v_row.failures := v_row.failures + 1;

  IF v_row.failures >= p_max THEN
    UPDATE auth_attempts
       SET failures = 0, window_started_at = v_now, locked_until = v_now + make_interval(secs => p_lock_seconds)
     WHERE key = p_key
    RETURNING auth_attempts.locked_until INTO v_row.locked_until;
    RETURN QUERY SELECT v_row.locked_until, TRUE;
  ELSE
    UPDATE auth_attempts SET failures = v_row.failures, window_started_at = v_row.window_started_at WHERE key = p_key;
    RETURN QUERY SELECT NULL::TIMESTAMPTZ, FALSE;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Is the account locked right now? Returns the unlock time, or NULL.
CREATE OR REPLACE FUNCTION public.get_auth_lock(p_key TEXT)
RETURNS TIMESTAMPTZ
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT locked_until FROM auth_attempts WHERE key = p_key AND locked_until > clock_timestamp()
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION public.clear_auth_attempts(p_key TEXT)
RETURNS VOID
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM auth_attempts WHERE key = p_key
$$ LANGUAGE sql;

REVOKE ALL ON FUNCTION public.record_auth_failure(TEXT, INT, INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_auth_lock(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_auth_attempts(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_auth_failure(TEXT, INT, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_auth_lock(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_auth_attempts(TEXT) TO service_role;

-- Housekeeping helper the API calls now and then: forget old, unlocked rows.
CREATE OR REPLACE FUNCTION public.purge_auth_attempts()
RETURNS VOID
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM auth_attempts
   WHERE (locked_until IS NULL OR locked_until < NOW()) AND window_started_at < NOW() - INTERVAL '1 day'
$$ LANGUAGE sql;
REVOKE ALL ON FUNCTION public.purge_auth_attempts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_auth_attempts() TO service_role;
