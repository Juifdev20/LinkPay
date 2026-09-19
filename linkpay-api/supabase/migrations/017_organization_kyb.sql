-- ============================================================================
-- 017_organization_kyb.sql — Full KYB (Know Your Business) profile for
-- enterprise accounts.
--
-- `organizations` only ever had name/legal_name/contact/status — nowhere near
-- enough for a real payments platform: no legal identifiers, business
-- sector, payout destination, legal representative, or receipt branding.
-- This adds all of it as either plain columns (queried/filtered on) or
-- grouped JSONB blobs (same convention as the existing `contact` column and
-- merchants.kyc_data), plus `onboarding_completed_at` — the gate the
-- frontend uses to require the full onboarding wizard before an enterprise
-- account can use its dashboard.
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS legal_form VARCHAR(50),
  ADD COLUMN IF NOT EXISTS legal_identifiers JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sector VARCHAR(50),
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'CDF',
  ADD COLUMN IF NOT EXISTS secondary_currencies TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tax_regime VARCHAR(20),
  ADD COLUMN IF NOT EXISTS payout_info JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS legal_representative JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS receipt_footer_message TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;
