-- ============================================================================
-- 050_app_access_code.sql — The "code d'accès" asked every time the app is
-- opened, left, or idle.
--
-- Each user chooses a 6-digit access code (separate from the account password
-- and from the transaction PIN). The app locks itself on every launch, when it
-- has been in the background, and after a few idle minutes; the code is checked
-- by the API, never by the phone.
--
-- Brute force protection lives here, in the database, because a thief with the
-- unlocked phone can fire many guesses at once:
--   begin_app_code_attempt  — runs BEFORE the code is compared. It refuses while
--                             locked, refuses (and locks) once 5 guesses are
--                             outstanding, otherwise counts the guess. Parallel
--                             requests can therefore never get more than 5
--                             comparisons per lock window.
--   fail_app_code_attempt   — after a wrong code: locks 15 min at the 5th miss;
--                             the 2nd lock in a row returns 'terminate' (the API
--                             then ends the session: full password login needed).
--   clear_app_code_failures — after a right code.
-- The hash itself is never readable through the public REST API (same technique
-- as 045/048). Only the API (service_role) can call the functions.
-- Run once in the Supabase SQL editor (after 049).
-- ============================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS app_code_hash TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS app_code_set_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS app_code_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS app_code_lockouts INT NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS app_code_locked_until TIMESTAMPTZ;

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
       'active_session_id', 'active_device_id', 'two_factor_last_step', 'two_factor_recovery_hashes',
       'app_code_hash', 'app_code_attempts', 'app_code_lockouts', 'app_code_locked_until'
     );
  REVOKE SELECT ON public.profiles FROM anon, authenticated;
  EXECUTE format('GRANT SELECT (%s) ON public.profiles TO authenticated', readable);
END $$;

CREATE OR REPLACE FUNCTION public.begin_app_code_attempt(p_user_id UUID)
RETURNS TABLE (status TEXT, attempts INT, locked_until TIMESTAMPTZ)
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_row profiles;
BEGIN
  SELECT * INTO v_row FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'missing'::TEXT, 0, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF v_row.app_code_locked_until IS NOT NULL AND v_row.app_code_locked_until > v_now THEN
    RETURN QUERY SELECT 'locked'::TEXT, v_row.app_code_attempts, v_row.app_code_locked_until;
    RETURN;
  END IF;

  -- Five guesses already spent and none confirmed right: lock now.
  IF v_row.app_code_attempts >= 5 THEN
    UPDATE profiles
       SET app_code_attempts = 0, app_code_lockouts = app_code_lockouts + 1,
           app_code_locked_until = v_now + INTERVAL '15 minutes'
     WHERE id = p_user_id
    RETURNING app_code_lockouts, app_code_locked_until INTO v_row.app_code_lockouts, v_row.app_code_locked_until;
    RETURN QUERY SELECT CASE WHEN v_row.app_code_lockouts >= 2 THEN 'terminate' ELSE 'locked' END::TEXT, 0, v_row.app_code_locked_until;
    RETURN;
  END IF;

  UPDATE profiles SET app_code_attempts = app_code_attempts + 1 WHERE id = p_user_id
  RETURNING app_code_attempts INTO v_row.app_code_attempts;
  RETURN QUERY SELECT 'ok'::TEXT, v_row.app_code_attempts, NULL::TIMESTAMPTZ;
END;
$$ LANGUAGE plpgsql;

-- Called after a wrong code. At the 5th miss the account locks right away.
CREATE OR REPLACE FUNCTION public.fail_app_code_attempt(p_user_id UUID)
RETURNS TABLE (status TEXT, attempts INT, locked_until TIMESTAMPTZ)
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row profiles;
BEGIN
  SELECT * INTO v_row FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'missing'::TEXT, 0, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF v_row.app_code_attempts >= 5 THEN
    UPDATE profiles
       SET app_code_attempts = 0, app_code_lockouts = app_code_lockouts + 1,
           app_code_locked_until = clock_timestamp() + INTERVAL '15 minutes'
     WHERE id = p_user_id
    RETURNING app_code_lockouts, app_code_locked_until INTO v_row.app_code_lockouts, v_row.app_code_locked_until;
    RETURN QUERY SELECT CASE WHEN v_row.app_code_lockouts >= 2 THEN 'terminate' ELSE 'locked' END::TEXT, 0, v_row.app_code_locked_until;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'ok'::TEXT, v_row.app_code_attempts, NULL::TIMESTAMPTZ;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.clear_app_code_failures(p_user_id UUID)
RETURNS VOID
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE profiles SET app_code_attempts = 0, app_code_lockouts = 0, app_code_locked_until = NULL WHERE id = p_user_id
$$ LANGUAGE sql;

REVOKE ALL ON FUNCTION public.begin_app_code_attempt(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_app_code_attempt(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_app_code_failures(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_app_code_attempt(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_app_code_attempt(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_app_code_failures(UUID) TO service_role;
