-- ============================================================================
-- 053_job_locks.sql — Scheduled jobs run on ONE API instance at a time.
--
-- With several API instances every @Cron job would run on each of them: duplicate reminder
-- notifications, duplicate alerts, two payouts reconciling the same withdrawal at once.
-- try_acquire_job_lock() is an atomic "lease": the first instance to ask gets it for
-- p_ttl_seconds, the others get false until it expires. Nothing needs releasing — set the
-- lease slightly shorter than the job's period and the next period is free again; if the
-- instance dies, the lease just runs out.
--
-- API only (no direct access from the public key). Run once in the Supabase SQL editor (after 052).
-- ============================================================================

CREATE TABLE IF NOT EXISTS job_locks (
  name TEXT PRIMARY KEY,
  locked_until TIMESTAMPTZ NOT NULL,
  locked_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE job_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON job_locks FROM PUBLIC, anon, authenticated;
GRANT ALL ON job_locks TO service_role;

CREATE OR REPLACE FUNCTION public.try_acquire_job_lock(p_name TEXT, p_ttl_seconds INT, p_owner TEXT)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_got TEXT;
BEGIN
  IF p_ttl_seconds < 1 OR p_ttl_seconds > 86400 THEN RAISE EXCEPTION 'JOB_LOCK_INVALID_TTL'; END IF;

  -- Takes the row if it doesn't exist, or if the previous lease has expired. Atomic: two
  -- instances asking at the same instant cannot both get it.
  INSERT INTO job_locks AS l (name, locked_until, locked_by)
  VALUES (p_name, NOW() + make_interval(secs => p_ttl_seconds), p_owner)
  ON CONFLICT (name) DO UPDATE
    SET locked_until = EXCLUDED.locked_until, locked_by = EXCLUDED.locked_by, updated_at = NOW()
    WHERE l.locked_until <= NOW()
  RETURNING l.name INTO v_got;

  RETURN v_got IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.try_acquire_job_lock(TEXT, INT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_acquire_job_lock(TEXT, INT, TEXT) TO service_role;
