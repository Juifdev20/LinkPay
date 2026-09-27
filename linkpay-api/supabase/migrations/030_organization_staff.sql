-- ============================================================================
-- 030_organization_staff.sql — Internal users an enterprise admin creates
-- for their organization (Magasinier/Vendeur/Caissier/Comptable/...).
--
-- A new table rather than extending `profiles` — `profiles` is shared by
-- every account type and has no room for the Congolese nom/postnom/prénom
-- naming convention or org-scoped staff metadata. `temp_password` holds the
-- admin-generated default password IN PLAIN TEXT, but only until the
-- employee's first successful password change: organizations-staff.service
-- (via AuthService.changePassword) sets it back to NULL at that point, so
-- it is never retrievable once used — the intended "single archived
-- credential" behavior, not a permanent secrets store. `must_change_password`
-- lives on `profiles` (see below) since forced-first-login-password-change
-- is a general account concept, not enterprise-specific.
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

CREATE TABLE IF NOT EXISTS organization_staff (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  nom VARCHAR(255) NOT NULL,
  postnom VARCHAR(255),
  prenom VARCHAR(255) NOT NULL,
  telephone VARCHAR(50),
  email VARCHAR(255) NOT NULL,
  temp_password TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organization_staff_org_id ON organization_staff(organization_id);
CREATE INDEX IF NOT EXISTS idx_organization_staff_user_id ON organization_staff(user_id);

DROP TRIGGER IF EXISTS set_updated_at ON organization_staff;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON organization_staff
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE organization_staff ENABLE ROW LEVEL SECURITY;

-- The org owner manages their own staff; a staff member can read their own
-- row (e.g. to know their own job role/name), same reasoning as
-- profiles_select_own in 001_initial_schema.sql.
DROP POLICY IF EXISTS organization_staff_select ON organization_staff;
CREATE POLICY organization_staff_select ON organization_staff FOR SELECT USING (
  auth.uid() = user_id
  OR auth.uid() IN (SELECT owner_id FROM organizations WHERE id = organization_staff.organization_id)
  OR public.is_admin()
);
DROP POLICY IF EXISTS organization_staff_insert ON organization_staff;
CREATE POLICY organization_staff_insert ON organization_staff FOR INSERT WITH CHECK (
  auth.uid() IN (SELECT owner_id FROM organizations WHERE id = organization_staff.organization_id)
);
DROP POLICY IF EXISTS organization_staff_update ON organization_staff;
CREATE POLICY organization_staff_update ON organization_staff FOR UPDATE USING (
  auth.uid() = user_id
  OR auth.uid() IN (SELECT owner_id FROM organizations WHERE id = organization_staff.organization_id)
);

-- Forced password-change-on-first-login flag — general account concept
-- (not enterprise-specific), hence on `profiles` rather than
-- `organization_staff`.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE;
