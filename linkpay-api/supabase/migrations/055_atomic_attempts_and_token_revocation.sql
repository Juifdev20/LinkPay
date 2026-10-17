-- ============================================================================
-- 055_atomic_attempts_and_token_revocation.sql — fixes found in the security review.
--
-- 1. Lockouts that a burst of parallel guesses could not slip past.
--    Until now: check "is it locked?" → verify the password / code / PIN → record the failure.
--    N requests sent at the same instant ALL passed the check before the first failure was written,
--    so an attacker got N guesses instead of 5. reserve_*() counts the attempt BEFORE it is verified,
--    under a row lock; the attempt that reaches the limit locks the account at once, so the requests
--    behind it are refused. A successful attempt clears the counter (clear_auth_attempts /
--    clear_pin_attempts), so a legitimate user's last allowed try is never held against them.
--
-- 2. Revoking administrator sessions. Administrators are exempt from the single-active-session rule,
--    so logging out, "reset session" or a 2FA reset did not invalidate a stolen token. A token now
--    dies when it was issued before profiles.tokens_valid_after (the API bumps it on those actions).
--
-- API only. Run once in the Supabase SQL editor (after 054).
-- ============================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tokens_valid_after TIMESTAMPTZ;

-- ---------------------------------------------------------------- login / 2FA / app-code style counters
CREATE OR REPLACE FUNCTION public.reserve_auth_attempt(
  p_key TEXT,
  p_max INT,
  p_window_seconds INT,
  p_lock_seconds INT
) RETURNS TABLE (allowed BOOLEAN, locked_until TIMESTAMPTZ, just_locked BOOLEAN)
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

  -- Already locked: this attempt is refused, and does not extend the lock.
  IF v_row.locked_until IS NOT NULL AND v_row.locked_until > v_now THEN
    RETURN QUERY SELECT FALSE, v_row.locked_until, FALSE;
    RETURN;
  END IF;

  IF v_row.window_started_at < v_now - make_interval(secs => p_window_seconds) THEN
    v_row.failures := 0;
    v_row.window_started_at := v_now;
  END IF;

  v_row.failures := v_row.failures + 1;

  IF v_row.failures >= p_max THEN
    -- This is the last attempt that is allowed: it proceeds, and anything behind it is refused.
    UPDATE auth_attempts
       SET failures = 0, window_started_at = v_now, locked_until = v_now + make_interval(secs => p_lock_seconds)
     WHERE key = p_key
    RETURNING auth_attempts.locked_until INTO v_row.locked_until;
    RETURN QUERY SELECT TRUE, v_row.locked_until, TRUE;
  ELSE
    UPDATE auth_attempts SET failures = v_row.failures, window_started_at = v_row.window_started_at WHERE key = p_key;
    RETURN QUERY SELECT TRUE, NULL::TIMESTAMPTZ, FALSE;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Gives an attempt back (it failed for a reason that isn't the user's fault: the auth provider was rate-limiting, say).
CREATE OR REPLACE FUNCTION public.release_auth_attempt(p_key TEXT)
RETURNS VOID
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE auth_attempts SET failures = GREATEST(failures - 1, 0) WHERE key = p_key AND (locked_until IS NULL OR locked_until <= clock_timestamp())
$$ LANGUAGE sql;

-- ---------------------------------------------------------------- transaction PIN
CREATE OR REPLACE FUNCTION public.reserve_pin_attempt(
  p_user UUID,
  p_max INT,
  p_lock_seconds INT
) RETURNS TABLE (has_pin BOOLEAN, allowed BOOLEAN, locked_until TIMESTAMPTZ, just_locked BOOLEAN, attempts INT)
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_p RECORD;
  v_attempts INT;
BEGIN
  SELECT transaction_pin_hash, pin_attempts, pin_locked_until INTO v_p FROM profiles WHERE id = p_user FOR UPDATE;
  IF NOT FOUND OR v_p.transaction_pin_hash IS NULL THEN
    RETURN QUERY SELECT FALSE, FALSE, NULL::TIMESTAMPTZ, FALSE, 0;
    RETURN;
  END IF;

  IF v_p.pin_locked_until IS NOT NULL AND v_p.pin_locked_until > v_now THEN
    RETURN QUERY SELECT TRUE, FALSE, v_p.pin_locked_until, FALSE, COALESCE(v_p.pin_attempts, 0);
    RETURN;
  END IF;

  v_attempts := COALESCE(v_p.pin_attempts, 0) + 1;
  IF v_attempts >= p_max THEN
    UPDATE profiles SET pin_attempts = 0, pin_locked_until = v_now + make_interval(secs => p_lock_seconds) WHERE id = p_user
    RETURNING profiles.pin_locked_until INTO v_p.pin_locked_until;
    RETURN QUERY SELECT TRUE, TRUE, v_p.pin_locked_until, TRUE, p_max;
  ELSE
    UPDATE profiles SET pin_attempts = v_attempts, pin_locked_until = NULL WHERE id = p_user;
    RETURN QUERY SELECT TRUE, TRUE, NULL::TIMESTAMPTZ, FALSE, v_attempts;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.clear_pin_attempts(p_user UUID)
RETURNS VOID
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE profiles SET pin_attempts = 0, pin_locked_until = NULL WHERE id = p_user
$$ LANGUAGE sql;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'reserve_auth_attempt(TEXT, INT, INT, INT)',
    'release_auth_attempt(TEXT)',
    'reserve_pin_attempt(UUID, INT, INT)',
    'clear_pin_attempts(UUID)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;
