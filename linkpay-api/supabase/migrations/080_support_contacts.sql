-- ============================================================================
-- 080_support_contacts.sql — The support contacts, set by the super admin.
--
-- Shown in Paramètres → Aide & support and on the "mot de passe oublié" screen. They used to be written in the
-- app's code; now the super admin changes them in Paramètres without a new release. NULL = not given: the app
-- simply doesn't show that line.
--
-- Run in the Supabase SQL editor (LinkPay Test first, then production), after 079.
-- ============================================================================

ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS support_phone TEXT
  CHECK (support_phone IS NULL OR length(support_phone) BETWEEN 6 AND 20);
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS support_whatsapp TEXT
  CHECK (support_whatsapp IS NULL OR length(support_whatsapp) BETWEEN 6 AND 20);
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS support_email TEXT
  CHECK (support_email IS NULL OR (length(support_email) <= 120 AND support_email LIKE '%_@_%'));
