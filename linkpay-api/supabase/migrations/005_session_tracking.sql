-- ============================================================================
-- 005_session_tracking.sql
-- Adds single-active-session-per-account enforcement, and enables Supabase
-- Realtime on the tables the frontend now subscribes to. Run this once in
-- the Supabase SQL editor (or `supabase db push`), same as previous
-- migrations.
-- ============================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS active_session_id UUID;

-- Realtime: tables must be explicitly added to this publication before any
-- postgres_changes subscription receives anything, even with RLS already
-- in place — RLS only decides *who* may see an event, not whether it's ever
-- published in the first place.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE transactions;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
