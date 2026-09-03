-- ============================================================================
-- Fix RLS policies: replace recursive policies with SECURITY DEFINER functions
-- ============================================================================

-- Drop all existing policies that cause infinite recursion
DROP POLICY IF EXISTS profiles_select_own ON profiles;
DROP POLICY IF EXISTS profiles_update_own ON profiles;
DROP POLICY IF EXISTS user_roles_select_own ON user_roles;
DROP POLICY IF EXISTS merchants_select_own ON merchants;
DROP POLICY IF EXISTS merchants_insert_own ON merchants;
DROP POLICY IF EXISTS merchants_update_own ON merchants;
DROP POLICY IF EXISTS orgs_select_own ON organizations;
DROP POLICY IF EXISTS orgs_insert_own ON organizations;
DROP POLICY IF EXISTS orgs_update_own ON organizations;
DROP POLICY IF EXISTS payment_requests_select_own ON payment_requests;
DROP POLICY IF EXISTS payment_intents_select_own ON payment_intents;
DROP POLICY IF EXISTS transactions_select_own ON transactions;
DROP POLICY IF EXISTS refunds_select_own ON refunds;
DROP POLICY IF EXISTS receipts_select_own ON receipts;
DROP POLICY IF EXISTS ledger_entries_admin_only ON ledger_entries;
DROP POLICY IF EXISTS settlements_select_own ON settlements;
DROP POLICY IF EXISTS webhook_events_admin_only ON webhook_events;
DROP POLICY IF EXISTS notifications_select_own ON notifications;
DROP POLICY IF EXISTS notifications_update_own ON notifications;
DROP POLICY IF EXISTS risk_logs_admin_only ON risk_logs;
DROP POLICY IF EXISTS audit_logs_admin_only ON audit_logs;
DROP POLICY IF EXISTS roles_select_all ON roles;
DROP POLICY IF EXISTS commission_rules_select_all ON commission_rules;

-- Helper function: check if current user is admin (SECURITY DEFINER bypasses RLS)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid()
      AND r.slug IN ('admin','super_admin')
  )
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Helper function: check if current user belongs to a merchant
CREATE OR REPLACE FUNCTION public.is_merchant_user(merchant_uuid UUID)
RETURNS BOOLEAN AS $$
  SELECT auth.uid() IN (
    SELECT user_id FROM user_roles WHERE merchant_id = merchant_uuid
  ) OR public.is_admin()
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- profiles: users can see/update own profile, admins can see all
CREATE POLICY profiles_select_own ON profiles FOR SELECT USING (
  auth.uid() = id OR public.is_admin()
);
CREATE POLICY profiles_insert_own ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY profiles_update_own ON profiles FOR UPDATE USING (auth.uid() = id);

-- roles: everyone can read
CREATE POLICY roles_select_all ON roles FOR SELECT USING (TRUE);

-- user_roles: users can see their own, admins can see all
CREATE POLICY user_roles_select_own ON user_roles FOR SELECT USING (
  auth.uid() = user_id OR public.is_admin()
);
CREATE POLICY user_roles_insert_own ON user_roles FOR INSERT WITH CHECK (
  auth.uid() = user_id OR public.is_admin()
);

-- merchants: owner + merchant users can see; admins can see all
CREATE POLICY merchants_select_own ON merchants FOR SELECT USING (
  auth.uid() = owner_id OR public.is_merchant_user(merchants.id)
);
CREATE POLICY merchants_insert_own ON merchants FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY merchants_update_own ON merchants FOR UPDATE USING (
  auth.uid() = owner_id OR public.is_admin()
);

-- organizations: owner can see/update
CREATE POLICY orgs_select_own ON organizations FOR SELECT USING (
  auth.uid() = owner_id OR public.is_admin()
);
CREATE POLICY orgs_insert_own ON organizations FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY orgs_update_own ON organizations FOR UPDATE USING (auth.uid() = owner_id);

-- commission_rules: everyone can read active rules
CREATE POLICY commission_rules_select_all ON commission_rules FOR SELECT USING (TRUE);

-- payment_requests: merchant users can see their own
CREATE POLICY payment_requests_select_own ON payment_requests FOR SELECT USING (
  public.is_merchant_user(payment_requests.merchant_id)
);

-- payment_intents: client can see own; merchant users can see their store's
CREATE POLICY payment_intents_select_own ON payment_intents FOR SELECT USING (
  auth.uid() = client_id OR public.is_merchant_user(
    (SELECT merchant_id FROM payment_requests WHERE id = payment_intents.payment_request_id)
  )
);

-- transactions: client sees own, merchant users see their store's, admins see all
CREATE POLICY transactions_select_own ON transactions FOR SELECT USING (
  auth.uid() = client_id OR public.is_merchant_user(transactions.merchant_id)
);

-- refunds: merchant users and admins
CREATE POLICY refunds_select_own ON refunds FOR SELECT USING (
  public.is_merchant_user(
    (SELECT merchant_id FROM transactions WHERE id = refunds.transaction_id)
  )
);

-- receipts: same as transactions
CREATE POLICY receipts_select_own ON receipts FOR SELECT USING (
  auth.uid() IN (
    SELECT t.client_id FROM transactions t WHERE t.id = receipts.transaction_id
  ) OR public.is_merchant_user(
    (SELECT merchant_id FROM transactions WHERE id = receipts.transaction_id)
  )
);

-- ledger_entries: admins only
CREATE POLICY ledger_entries_admin_only ON ledger_entries FOR SELECT USING (public.is_admin());

-- settlements: merchant owners and admins
CREATE POLICY settlements_select_own ON settlements FOR SELECT USING (
  public.is_merchant_user(settlements.merchant_id)
);

-- webhook_events: admins only
CREATE POLICY webhook_events_admin_only ON webhook_events FOR SELECT USING (public.is_admin());

-- notifications: users see own only
CREATE POLICY notifications_select_own ON notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY notifications_update_own ON notifications FOR UPDATE USING (auth.uid() = user_id);

-- risk_logs: admins only
CREATE POLICY risk_logs_admin_only ON risk_logs FOR SELECT USING (public.is_admin());

-- audit_logs: admins only
CREATE POLICY audit_logs_admin_only ON audit_logs FOR SELECT USING (public.is_admin());
