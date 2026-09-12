-- ============================================================================
-- 011_webauthn_credentials.sql — WebAuthn platform authenticator credentials
-- Run once in the Supabase SQL editor, same as previous migrations.
--
-- One row per registered platform authenticator (Windows Hello, Android
-- fingerprint/face, iOS Touch/Face ID) — inherently per-device, mirroring
-- push_subscriptions' one-row-per-registration shape (010_push_subscriptions.sql).
-- Used exclusively by the optional app-lock feature (Settings toggle): it
-- re-locks the UI on open/resume even though the underlying JWT session
-- stays valid — it is not a login mechanism.
-- ============================================================================

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,       -- base64url, from the authenticator
  public_key TEXT NOT NULL,                 -- base64url-encoded COSE public key
  counter BIGINT NOT NULL DEFAULT 0,        -- signature counter, replay protection
  device_name TEXT,                         -- user-agent-derived label, e.g. "Chrome sur Windows"
  transports TEXT[],                        -- e.g. {internal}
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user_id ON webauthn_credentials(user_id);

-- ----------------------------------------------------------------------------
-- RLS — safety net only; the NestJS backend always uses the Supabase
-- service-role key (bypasses RLS) via SupabaseService, same as every other
-- table in this project.
-- ----------------------------------------------------------------------------
ALTER TABLE webauthn_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webauthn_credentials_select_own ON webauthn_credentials;
CREATE POLICY webauthn_credentials_select_own ON webauthn_credentials FOR SELECT USING (
  auth.uid() = user_id OR public.is_admin()
);

DROP POLICY IF EXISTS webauthn_credentials_insert_own ON webauthn_credentials;
CREATE POLICY webauthn_credentials_insert_own ON webauthn_credentials FOR INSERT WITH CHECK (
  auth.uid() = user_id
);

DROP POLICY IF EXISTS webauthn_credentials_delete_own ON webauthn_credentials;
CREATE POLICY webauthn_credentials_delete_own ON webauthn_credentials FOR DELETE USING (
  auth.uid() = user_id OR public.is_admin()
);
