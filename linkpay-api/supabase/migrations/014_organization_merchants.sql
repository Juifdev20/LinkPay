-- ============================================================================
-- 014_organization_merchants.sql — Multi-store support for enterprise
-- accounts.
--
-- Until now `organizations` and `merchants` had no relationship at all in
-- the schema — an enterprise account could only edit its own contact info,
-- nothing else. This adds:
--   - merchants.organization_id: links a store to the organization that
--     created it (nullable — the vast majority of merchants are standalone,
--     never touched by an organization).
--   - The FK constraint user_roles.organization_id was always missing
--     since 001_initial_schema.sql — closing that gap while we're here.
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_merchants_organization_id ON merchants(organization_id);

ALTER TABLE user_roles
  ADD CONSTRAINT user_roles_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;

-- Safety net only (the backend always uses the service-role key, which
-- bypasses RLS) — but let an organization's owner SELECT any merchant row
-- belonging to their org, same spirit as is_merchant_user() below.
CREATE OR REPLACE FUNCTION public.is_org_owner_of_merchant(merchant_uuid UUID)
RETURNS BOOLEAN AS $$
  SELECT auth.uid() IN (
    SELECT o.owner_id
    FROM merchants m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.id = merchant_uuid
  )
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

DROP POLICY IF EXISTS merchants_select_own ON merchants;
CREATE POLICY merchants_select_own ON merchants FOR SELECT USING (
  auth.uid() = owner_id
  OR public.is_merchant_user(merchants.id)
  OR public.is_org_owner_of_merchant(merchants.id)
);
