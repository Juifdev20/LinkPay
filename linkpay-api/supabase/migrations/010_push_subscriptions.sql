-- ============================================================================
-- 010_push_subscriptions.sql — Web Push (VAPID) subscription storage
-- Run once in the Supabase SQL editor, same as previous migrations.
--
-- One row per browser/device push registration. `endpoint` is the push
-- service's per-registration URL and is already globally unique on the web
-- (it isn't scoped to LinkPay) — used as the natural conflict target so a
-- device re-subscribing (e.g. after clearing storage, or logging into a
-- different LinkPay account on the same browser) upserts in place instead
-- of erroring or leaving stale duplicate rows.
-- ============================================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);

-- ----------------------------------------------------------------------------
-- RLS — safety net only; the NestJS backend always uses the Supabase
-- service-role key (bypasses RLS) via SupabaseService, same as every other
-- table in this project.
-- ----------------------------------------------------------------------------
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_subscriptions_select_own ON push_subscriptions;
CREATE POLICY push_subscriptions_select_own ON push_subscriptions FOR SELECT USING (
  auth.uid() = user_id OR public.is_admin()
);

DROP POLICY IF EXISTS push_subscriptions_insert_own ON push_subscriptions;
CREATE POLICY push_subscriptions_insert_own ON push_subscriptions FOR INSERT WITH CHECK (
  auth.uid() = user_id
);

DROP POLICY IF EXISTS push_subscriptions_delete_own ON push_subscriptions;
CREATE POLICY push_subscriptions_delete_own ON push_subscriptions FOR DELETE USING (
  auth.uid() = user_id OR public.is_admin()
);
