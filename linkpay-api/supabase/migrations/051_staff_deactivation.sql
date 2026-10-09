-- ============================================================================
-- 051_staff_deactivation.sql — Remove an employee's access without deleting
-- their history.
--
-- A departing employee's account is blocked in Supabase Auth (cannot log in)
-- and its sessions are cut by the API; this just records when and by whom, so
-- the Staff screen can show "Accès retiré" and offer to restore it. The sales,
-- stock movements and audit entries they made keep pointing at their account.
-- The API blocks the account FIRST, so access is cut even if this migration has
-- not been applied yet.
-- Run once in the Supabase SQL editor (after 050).
-- ============================================================================

ALTER TABLE organization_staff ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE organization_staff ADD COLUMN IF NOT EXISTS deactivated_by UUID REFERENCES auth.users(id);
