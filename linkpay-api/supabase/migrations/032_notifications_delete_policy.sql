-- ============================================================================
-- 032_notifications_delete_policy.sql — Lets a user delete their own
-- notifications.
--
-- Only `notifications_select_own` and `notifications_update_own` exist
-- today (001_initial_schema.sql) — no DELETE policy. The backend uses the
-- service-role key (bypasses RLS) so this isn't strictly required for the
-- app to work, but it keeps the schema internally consistent with every
-- other "own row" policy already in place, and is needed if anything ever
-- deletes directly via a user-scoped Supabase client (e.g. Realtime-adjacent
-- tooling) instead of through the API.
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

DROP POLICY IF EXISTS notifications_delete_own ON notifications;
CREATE POLICY notifications_delete_own ON notifications FOR DELETE USING (auth.uid() = user_id);
