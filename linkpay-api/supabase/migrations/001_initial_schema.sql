-- ============================================================================
-- LinkPay Initial Schema Migration
-- ============================================================================
-- This migration creates all core tables, indexes, constraints, and RLS policies
-- for the LinkPay payment platform.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE merchant_status AS ENUM ('pending', 'active', 'suspended', 'rejected', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_request_status AS ENUM ('CREATED', 'PENDING', 'PAID', 'CANCELLED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_intent_status AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE transaction_status AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE refund_status AS ENUM ('PENDING', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE settlement_status AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE commission_model AS ENUM ('MERCHANT_PAID', 'CUSTOMER_PAID', 'SHARED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ledger_entry_type AS ENUM ('PAYMENT', 'PSP_FEE', 'PLATFORM_FEE', 'REFUND', 'SETTLEMENT', 'ADJUSTMENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ledger_direction AS ENUM ('credit', 'debit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE org_status AS ENUM ('pending', 'active', 'suspended', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- profiles (extends Supabase auth.users)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  full_name TEXT,
  avatar_url TEXT,
  two_factor_enabled BOOLEAN DEFAULT FALSE,
  two_factor_secret TEXT,
  preferred_language VARCHAR(10) DEFAULT 'fr',
  status VARCHAR(20) DEFAULT 'active',
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- roles
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  permissions JSONB DEFAULT '[]'::jsonb,
  is_system BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- merchants
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS merchants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  legal_name VARCHAR(255),
  type VARCHAR(50) DEFAULT 'individual',
  phone VARCHAR(50),
  email VARCHAR(255),
  address TEXT,
  city VARCHAR(100),
  country VARCHAR(10) DEFAULT 'CD',
  logo_url TEXT,
  status merchant_status DEFAULT 'pending',
  commission_rule_id UUID,
  kyc_status VARCHAR(20) DEFAULT 'pending',
  kyc_data JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- user_roles
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  organization_id UUID,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by UUID REFERENCES auth.users(id),
  UNIQUE(user_id, role_id, merchant_id)
);

-- ----------------------------------------------------------------------------
-- organizations
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  legal_name VARCHAR(255),
  contact JSONB DEFAULT '{}'::jsonb,
  status org_status DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- commission_rules
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commission_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  percent NUMERIC(6,4) NOT NULL DEFAULT 0.0250,
  fixed_cents BIGINT DEFAULT 0,
  min_cents BIGINT,
  max_cents BIGINT,
  currency VARCHAR(10) DEFAULT 'CDF',
  applies_to VARCHAR(20) DEFAULT 'all',
  target_id UUID,
  version INT DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  valid_from TIMESTAMPTZ DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- payment_requests
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  merchant_user_id UUID REFERENCES auth.users(id),
  amount_cents BIGINT NOT NULL,
  currency VARCHAR(10) DEFAULT 'CDF',
  reference VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  customer_info JSONB DEFAULT '{}'::jsonb,
  link_token VARCHAR(64) UNIQUE NOT NULL,
  qr_code_url TEXT,
  status payment_request_status DEFAULT 'CREATED',
  commission_model commission_model DEFAULT 'MERCHANT_PAID',
  expires_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- payment_intents
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_intents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_request_id UUID NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
  client_id UUID REFERENCES auth.users(id),
  amount_cents BIGINT NOT NULL,
  currency VARCHAR(10) DEFAULT 'CDF',
  fees_cents BIGINT DEFAULT 0,
  total_cents BIGINT NOT NULL,
  psp_intent_id VARCHAR(255),
  psp_provider VARCHAR(50) DEFAULT 'mock',
  psp_response JSONB DEFAULT '{}'::jsonb,
  idempotency_key VARCHAR(255) UNIQUE NOT NULL,
  status payment_intent_status DEFAULT 'PENDING',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- transactions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_intent_id UUID REFERENCES payment_intents(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  client_id UUID REFERENCES auth.users(id),
  amount_cents BIGINT NOT NULL,
  psp_fee_cents BIGINT DEFAULT 0,
  platform_fee_cents BIGINT DEFAULT 0,
  other_fees_cents BIGINT DEFAULT 0,
  net_cents BIGINT NOT NULL,
  currency VARCHAR(10) DEFAULT 'CDF',
  status transaction_status DEFAULT 'PENDING',
  reference VARCHAR(100) UNIQUE NOT NULL,
  psp_reference VARCHAR(255),
  commission_rule_id UUID REFERENCES commission_rules(id),
  commission_model commission_model DEFAULT 'MERCHANT_PAID',
  settlement_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- refunds
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refunds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL,
  currency VARCHAR(10) DEFAULT 'CDF',
  reason TEXT,
  status refund_status DEFAULT 'PENDING',
  psp_refund_id VARCHAR(255),
  processed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- receipts
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS receipts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  pdf_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- ledger_entries
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE,
  settlement_id UUID,
  entry_type ledger_entry_type NOT NULL,
  direction ledger_direction NOT NULL,
  amount_cents BIGINT NOT NULL,
  currency VARCHAR(10) DEFAULT 'CDF',
  reference VARCHAR(100),
  source VARCHAR(50) DEFAULT 'system',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- settlements
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settlements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  gross_cents BIGINT NOT NULL,
  psp_fees_cents BIGINT DEFAULT 0,
  platform_fees_cents BIGINT DEFAULT 0,
  net_cents BIGINT NOT NULL,
  currency VARCHAR(10) DEFAULT 'CDF',
  status settlement_status DEFAULT 'PENDING',
  reference VARCHAR(100) UNIQUE NOT NULL,
  transaction_count INT DEFAULT 0,
  notes TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- webhook_events
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider VARCHAR(50) NOT NULL,
  event_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(100),
  payload JSONB NOT NULL,
  signature TEXT,
  dedup_hash VARCHAR(255) UNIQUE NOT NULL,
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- notifications
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  data JSONB DEFAULT '{}'::jsonb,
  read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- risk_logs
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS risk_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE,
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  risk_score INT DEFAULT 0,
  flags JSONB DEFAULT '[]'::jsonb,
  resolved BOOLEAN DEFAULT FALSE,
  resolution TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- audit_logs
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id UUID,
  changes JSONB DEFAULT '{}'::jsonb,
  ip_address VARCHAR(100),
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------
-- (profiles.id is already the auth.users id, no separate index needed)
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_merchant_id ON user_roles(merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchants_owner_id ON merchants(owner_id);
CREATE INDEX IF NOT EXISTS idx_merchants_status ON merchants(status);
CREATE INDEX IF NOT EXISTS idx_organizations_owner_id ON organizations(owner_id);
CREATE INDEX IF NOT EXISTS idx_commission_rules_active ON commission_rules(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_payment_requests_merchant_id ON payment_requests(merchant_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_link_token ON payment_requests(link_token);
CREATE INDEX IF NOT EXISTS idx_payment_requests_reference ON payment_requests(reference);
CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON payment_requests(status);
CREATE INDEX IF NOT EXISTS idx_payment_intents_request_id ON payment_intents(payment_request_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_idempotency_key ON payment_intents(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_payment_intents_psp_intent_id ON payment_intents(psp_intent_id);
CREATE INDEX IF NOT EXISTS idx_transactions_merchant_id ON transactions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_transactions_client_id ON transactions(client_id);
CREATE INDEX IF NOT EXISTS idx_transactions_reference ON transactions(reference);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_settlement_id ON transactions(settlement_id);
CREATE INDEX IF NOT EXISTS idx_refunds_transaction_id ON refunds(transaction_id);
CREATE INDEX IF NOT EXISTS idx_receipts_transaction_id ON receipts(transaction_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_transaction_id ON ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_settlement_id ON ledger_entries(settlement_id);
CREATE INDEX IF NOT EXISTS idx_settlements_merchant_id ON settlements(merchant_id);
CREATE INDEX IF NOT EXISTS idx_settlements_status ON settlements(status);
CREATE INDEX IF NOT EXISTS idx_webhook_events_dedup_hash ON webhook_events(dedup_hash);
CREATE INDEX IF NOT EXISTS idx_webhook_events_provider ON webhook_events(provider);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read) WHERE read = FALSE;
CREATE INDEX IF NOT EXISTS idx_risk_logs_transaction_id ON risk_logs(transaction_id);
CREATE INDEX IF NOT EXISTS idx_risk_logs_resolved ON risk_logs(resolved) WHERE resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type ON audit_logs(entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- ----------------------------------------------------------------------------
-- Updated_at triggers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'profiles','roles','merchants','organizations','commission_rules',
    'payment_requests','payment_intents','transactions','refunds',
    'settlements'
  ]) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON %I', t);
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- Auto-create profile on auth.users insert
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, phone)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'phone');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Note: auth.uid() is provided by Supabase built-in, no need to redefine it.

-- Helper function: check if current user is admin (bypasses RLS to avoid recursion)
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

-- payment_requests: merchant users can see their own; public can access via link_token
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
