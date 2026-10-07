-- ============================================================================
-- 039_platform_settings.sql — Platform-wide switches the super admin controls.
--
-- A SINGLE row (id = 1), same shape as expense_tracker_settings (025): these
-- are global decisions for the whole platform, not per-organization ones.
--
-- screenshot_protection: when true, the Android app sets FLAG_SECURE on its
-- window — screenshots, screen recordings and the recent-apps preview come
-- out black, on every account (what WhatsApp does). Browsers offer no such
-- control, so the web/PWA version can't be protected.
--
-- Read publicly through the API (GET /platform/settings is @Public — the
-- login and PIN screens must be protected too); written only by the API with
-- the service key (PUT /admin/platform-settings, super_admin).
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

CREATE TABLE IF NOT EXISTS platform_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  screenshot_protection BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

INSERT INTO platform_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- No policies: only the API (service key, bypasses RLS) reads and writes it.
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
