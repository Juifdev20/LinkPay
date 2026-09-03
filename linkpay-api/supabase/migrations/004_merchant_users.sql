-- ============================================================================
-- 004_merchant_users.sql
-- Creates the merchant_users table referenced by merchants.service.ts /
-- merchants.controller.ts (team management) since app inception, but never
-- actually defined in a migration — every insert into it has been silently
-- failing ("Could not find the table 'public.merchant_users' in the schema
-- cache"). Run this once in the Supabase SQL editor (or `supabase db push`).
-- ============================================================================

CREATE TABLE IF NOT EXISTS merchant_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(merchant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_merchant_users_merchant_id ON merchant_users(merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_users_user_id ON merchant_users(user_id);

ALTER TABLE merchant_users ENABLE ROW LEVEL SECURITY;

-- Owner (merchants.owner_id) and the member themselves can see a row;
-- admins can see all. Only the merchant owner (or an admin) can add/remove
-- team members — enforced here too, in addition to the app-level ownership
-- check in merchants.controller.ts.
CREATE POLICY merchant_users_select ON merchant_users FOR SELECT USING (
  auth.uid() = user_id
  OR auth.uid() IN (SELECT owner_id FROM merchants WHERE id = merchant_users.merchant_id)
  OR public.is_admin()
);

CREATE POLICY merchant_users_insert_owner ON merchant_users FOR INSERT WITH CHECK (
  auth.uid() IN (SELECT owner_id FROM merchants WHERE id = merchant_users.merchant_id)
  OR public.is_admin()
);

CREATE POLICY merchant_users_delete_owner ON merchant_users FOR DELETE USING (
  auth.uid() IN (SELECT owner_id FROM merchants WHERE id = merchant_users.merchant_id)
  OR public.is_admin()
);
