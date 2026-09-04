-- ============================================================================
-- 009_device_binding.sql — same-device session reclaim
-- Run once in the Supabase SQL editor, same as previous migrations.
--
-- Pairs with active_session_id (005_session_tracking.sql). Lets a device
-- that already holds a session silently reclaim it on a fresh login (e.g.
-- its stored tokens were lost to a network blip, not an explicit logout)
-- without the single-active-session conflict — while a genuinely different
-- device is still blocked exactly as before (409, admin reset required).
-- ============================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS active_device_id TEXT;
