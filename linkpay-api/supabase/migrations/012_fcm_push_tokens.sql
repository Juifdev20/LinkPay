-- ============================================================================
-- 012_fcm_push_tokens.sql — Firebase Cloud Messaging support on
-- push_subscriptions, alongside the existing Web Push (VAPID) rows.
--
-- The Capacitor Android app can't receive Web Push in its WebView — it
-- registers an FCM token instead. Rather than a parallel table, this adds a
-- `platform` discriminator + `fcm_token` column to the existing table, so
-- NotificationsService's single sendPush() fan-out just branches per row.
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

ALTER TABLE push_subscriptions
  ALTER COLUMN endpoint DROP NOT NULL,
  ALTER COLUMN p256dh DROP NOT NULL,
  ALTER COLUMN auth DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS fcm_token TEXT UNIQUE;

ALTER TABLE push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_platform_fields_chk;
ALTER TABLE push_subscriptions
  ADD CONSTRAINT push_subscriptions_platform_fields_chk CHECK (
    (platform = 'web' AND endpoint IS NOT NULL AND p256dh IS NOT NULL AND auth IS NOT NULL)
    OR (platform = 'android' AND fcm_token IS NOT NULL)
  );
