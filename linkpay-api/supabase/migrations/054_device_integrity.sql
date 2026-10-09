-- ============================================================================
-- 054_device_integrity.sql — Is the phone running the app trustworthy?
--
-- The Android app asks Google Play Integrity to vouch for (a) the app (genuine, unmodified,
-- signed by us) and (b) the device (certified, not rooted / emulated / bootloader-unlocked), and
-- sends the signed verdict to the API, which verifies it with Google and records the outcome here.
-- DEVICE_INTEGRITY_MODE (off | warn | enforce) decides what the API does with it: money leaving
-- a wallet from an Android-app session needs a recent TRUSTED verdict when it is "enforce".
--
-- profiles.active_client_platform remembers where the current session was opened (android-app,
-- web…), set at login by the API, so the rule follows the SESSION rather than a header an attacker
-- who replays a stolen token could simply leave out.
--
-- API only. Run once in the Supabase SQL editor (after 053).
-- ============================================================================

CREATE TABLE IF NOT EXISTS device_attestations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('trusted', 'untrusted')),
  -- Why it is untrusted (device_not_certified, app_not_recognized, client_reports_root, …).
  reasons TEXT[] NOT NULL DEFAULT '{}',
  -- What the app's own checks saw (su_binary, test_keys, …): advisory — a rooted device can lie.
  client_signals TEXT[] NOT NULL DEFAULT '{}',
  app_version TEXT,
  -- Hash of the one-time challenge: the same signed verdict can't be replayed.
  nonce_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_device_attestations_user ON device_attestations(user_id, created_at DESC);

ALTER TABLE device_attestations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON device_attestations FROM PUBLIC, anon, authenticated;
GRANT ALL ON device_attestations TO service_role;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS active_client_platform TEXT;
