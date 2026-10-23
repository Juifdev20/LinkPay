-- ============================================================================
-- 081_admin_2fa_pause.sql — The super admin can suspend the administrators' second factor for a while.
--
-- Asked for the development period, where typing the authenticator code at every login and before every
-- sensitive action slows the team down. NULL = the second factor is required (the normal state). A date = not
-- required until then; it comes back on by itself at that date, or as soon as the super admin turns it back on.
-- What stays while it is suspended: the password, the allowed admin networks (ADMIN_ALLOWED_IPS), the audit and
-- the alert sent to every super admin when someone suspends or re-enables it.
--
-- Run in the Supabase SQL editor (LinkPay Test first, then production), after 080.
-- ============================================================================

ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS admin_2fa_paused_until TIMESTAMPTZ;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS admin_2fa_paused_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
