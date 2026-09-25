-- ============================================================================
-- setup_new_project.sql — ALL migrations combined, in order, for bootstrapping
-- a BRAND NEW, EMPTY Supabase project in one paste.
--
-- Generated from migrations/001_initial_schema.sql through
-- migrations/023_savings_multi_currency.sql. Do NOT run this against the
-- existing production project — most statements are idempotent (IF NOT
-- EXISTS / IF EXISTS / CREATE OR REPLACE) but not all (some ADD CONSTRAINT
-- statements aren't), so it's only safe on an empty database. For any
-- future migration added after this file was generated, run it separately
-- as usual, numbered, after this.
--
-- Contains a couple of explicit COMMIT; statements (see inline notes) —
-- required so Postgres can use an enum value in the same script right
-- after adding it via ALTER TYPE ... ADD VALUE, which Postgres forbids
-- within the same transaction. Paste this whole file into the Supabase
-- SQL editor and run it once, on a truly empty project (reset/recreate
-- the project first if a previous partial attempt already ran some
-- migrations by hand — several ADD CONSTRAINT statements later in this
-- script are NOT safe to run twice).
-- ============================================================================


-- ============================================================================
-- Source: migrations/001_initial_schema.sql
-- ============================================================================
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
DROP POLICY IF EXISTS profiles_select_own ON profiles;
CREATE POLICY profiles_select_own ON profiles FOR SELECT USING (
  auth.uid() = id OR public.is_admin()
);
DROP POLICY IF EXISTS profiles_insert_own ON profiles;
CREATE POLICY profiles_insert_own ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS profiles_update_own ON profiles;
CREATE POLICY profiles_update_own ON profiles FOR UPDATE USING (auth.uid() = id);

-- roles: everyone can read
DROP POLICY IF EXISTS roles_select_all ON roles;
CREATE POLICY roles_select_all ON roles FOR SELECT USING (TRUE);

-- user_roles: users can see their own, admins can see all
DROP POLICY IF EXISTS user_roles_select_own ON user_roles;
CREATE POLICY user_roles_select_own ON user_roles FOR SELECT USING (
  auth.uid() = user_id OR public.is_admin()
);
DROP POLICY IF EXISTS user_roles_insert_own ON user_roles;
CREATE POLICY user_roles_insert_own ON user_roles FOR INSERT WITH CHECK (
  auth.uid() = user_id OR public.is_admin()
);

-- merchants: owner + merchant users can see; admins can see all
DROP POLICY IF EXISTS merchants_select_own ON merchants;
CREATE POLICY merchants_select_own ON merchants FOR SELECT USING (
  auth.uid() = owner_id OR public.is_merchant_user(merchants.id)
);
DROP POLICY IF EXISTS merchants_insert_own ON merchants;
CREATE POLICY merchants_insert_own ON merchants FOR INSERT WITH CHECK (auth.uid() = owner_id);
DROP POLICY IF EXISTS merchants_update_own ON merchants;
CREATE POLICY merchants_update_own ON merchants FOR UPDATE USING (
  auth.uid() = owner_id OR public.is_admin()
);

-- organizations: owner can see/update
DROP POLICY IF EXISTS orgs_select_own ON organizations;
CREATE POLICY orgs_select_own ON organizations FOR SELECT USING (
  auth.uid() = owner_id OR public.is_admin()
);
DROP POLICY IF EXISTS orgs_insert_own ON organizations;
CREATE POLICY orgs_insert_own ON organizations FOR INSERT WITH CHECK (auth.uid() = owner_id);
DROP POLICY IF EXISTS orgs_update_own ON organizations;
CREATE POLICY orgs_update_own ON organizations FOR UPDATE USING (auth.uid() = owner_id);

-- commission_rules: everyone can read active rules
DROP POLICY IF EXISTS commission_rules_select_all ON commission_rules;
CREATE POLICY commission_rules_select_all ON commission_rules FOR SELECT USING (TRUE);

-- payment_requests: merchant users can see their own; public can access via link_token
DROP POLICY IF EXISTS payment_requests_select_own ON payment_requests;
CREATE POLICY payment_requests_select_own ON payment_requests FOR SELECT USING (
  public.is_merchant_user(payment_requests.merchant_id)
);

-- payment_intents: client can see own; merchant users can see their store's
DROP POLICY IF EXISTS payment_intents_select_own ON payment_intents;
CREATE POLICY payment_intents_select_own ON payment_intents FOR SELECT USING (
  auth.uid() = client_id OR public.is_merchant_user(
    (SELECT merchant_id FROM payment_requests WHERE id = payment_intents.payment_request_id)
  )
);

-- transactions: client sees own, merchant users see their store's, admins see all
DROP POLICY IF EXISTS transactions_select_own ON transactions;
CREATE POLICY transactions_select_own ON transactions FOR SELECT USING (
  auth.uid() = client_id OR public.is_merchant_user(transactions.merchant_id)
);

-- refunds: merchant users and admins
DROP POLICY IF EXISTS refunds_select_own ON refunds;
CREATE POLICY refunds_select_own ON refunds FOR SELECT USING (
  public.is_merchant_user(
    (SELECT merchant_id FROM transactions WHERE id = refunds.transaction_id)
  )
);

-- receipts: same as transactions
DROP POLICY IF EXISTS receipts_select_own ON receipts;
CREATE POLICY receipts_select_own ON receipts FOR SELECT USING (
  auth.uid() IN (
    SELECT t.client_id FROM transactions t WHERE t.id = receipts.transaction_id
  ) OR public.is_merchant_user(
    (SELECT merchant_id FROM transactions WHERE id = receipts.transaction_id)
  )
);

-- ledger_entries: admins only
DROP POLICY IF EXISTS ledger_entries_admin_only ON ledger_entries;
CREATE POLICY ledger_entries_admin_only ON ledger_entries FOR SELECT USING (public.is_admin());

-- settlements: merchant owners and admins
DROP POLICY IF EXISTS settlements_select_own ON settlements;
CREATE POLICY settlements_select_own ON settlements FOR SELECT USING (
  public.is_merchant_user(settlements.merchant_id)
);

-- webhook_events: admins only
DROP POLICY IF EXISTS webhook_events_admin_only ON webhook_events;
CREATE POLICY webhook_events_admin_only ON webhook_events FOR SELECT USING (public.is_admin());

-- notifications: users see own only
DROP POLICY IF EXISTS notifications_select_own ON notifications;
CREATE POLICY notifications_select_own ON notifications FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS notifications_update_own ON notifications;
CREATE POLICY notifications_update_own ON notifications FOR UPDATE USING (auth.uid() = user_id);

-- risk_logs: admins only
DROP POLICY IF EXISTS risk_logs_admin_only ON risk_logs;
CREATE POLICY risk_logs_admin_only ON risk_logs FOR SELECT USING (public.is_admin());

-- audit_logs: admins only
DROP POLICY IF EXISTS audit_logs_admin_only ON audit_logs;
CREATE POLICY audit_logs_admin_only ON audit_logs FOR SELECT USING (public.is_admin());

-- ============================================================================
-- Source: migrations/002_seed_data.sql
-- ============================================================================
-- ============================================================================
-- LinkPay Seed Data
-- ============================================================================
-- Inserts default roles and a default commission rule.
-- ============================================================================

-- Default roles
INSERT INTO roles (slug, name, description, permissions, is_system) VALUES
  ('super_admin', 'Super Admin', 'Full platform access', '["*"]'::jsonb, TRUE),
  ('admin', 'Administrator', 'Platform administration', '["merchants.*","users.*","transactions.*","settlements.*","commissions.*","risk.*","audit.*"]'::jsonb, TRUE),
  ('enterprise', 'Enterprise', 'Organization owner with multi-store management', '["merchants.*","payment_requests.*","transactions.read","settlements.*","refunds.*"]'::jsonb, TRUE),
  ('merchant', 'Merchant', 'Store owner', '["payment_requests.*","transactions.read","settlements.*","refunds.*","users.invite"]'::jsonb, TRUE),
  ('cashier', 'Cashier', 'Store cashier — create payment requests', '["payment_requests.create","payment_requests.read","transactions.read"]'::jsonb, TRUE),
  ('client', 'Client', 'End customer — make payments', '["payments.create","transactions.read_own","receipts.read_own"]'::jsonb, TRUE)
ON CONFLICT (slug) DO NOTHING;

-- Default global commission rule: 2.5% with 0 fixed fee
INSERT INTO commission_rules (name, description, percent, fixed_cents, min_cents, max_cents, currency, applies_to, is_active)
VALUES (
  'Standard 2.5%',
  'Default commission rate for all merchants',
  0.0250,
  0,
  50,
  500000,
  'CDF',
  'all',
  TRUE
)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- Source: migrations/003_fix_rls_policies.sql
-- ============================================================================
-- ============================================================================
-- Fix RLS policies: replace recursive policies with SECURITY DEFINER functions
-- ============================================================================

-- Drop all existing policies that cause infinite recursion
-- (profiles_insert_own/user_roles_insert_own were already created by
-- 001_initial_schema.sql and re-declared below identically — dropped here
-- too so this migration replays cleanly on a fresh database, not just on
-- the original project where they'd been dropped by hand at the time.)
DROP POLICY IF EXISTS profiles_select_own ON profiles;
DROP POLICY IF EXISTS profiles_insert_own ON profiles;
DROP POLICY IF EXISTS profiles_update_own ON profiles;
DROP POLICY IF EXISTS user_roles_select_own ON user_roles;
DROP POLICY IF EXISTS user_roles_insert_own ON user_roles;
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

-- ============================================================================
-- Source: migrations/004_merchant_users.sql
-- ============================================================================
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

-- ============================================================================
-- Source: migrations/005_session_tracking.sql
-- ============================================================================
-- ============================================================================
-- 005_session_tracking.sql
-- Adds single-active-session-per-account enforcement, and enables Supabase
-- Realtime on the tables the frontend now subscribes to. Run this once in
-- the Supabase SQL editor (or `supabase db push`), same as previous
-- migrations.
-- ============================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS active_session_id UUID;

-- Realtime: tables must be explicitly added to this publication before any
-- postgres_changes subscription receives anything, even with RLS already
-- in place — RLS only decides *who* may see an event, not whether it's ever
-- published in the first place.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE transactions;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- Source: migrations/006_wallets.sql
-- ============================================================================
-- ============================================================================
-- 006_wallets.sql — LinkPay Wallet, Phase 1 (compte + numéro + recharge)
-- Run once in the Supabase SQL editor (or `supabase db push`), same as
-- previous migrations.
--
-- IMPORTANT — regulatory note: a rechargeable balance makes LinkPay an
-- e-money issuer in DRC, which normally requires a Banque Centrale du Congo
-- license or a partnership with an already-licensed institution. This
-- migration builds the technical architecture for development/demo purposes
-- only — it does not itself make the platform compliant for public launch.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- wallets
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS wallet_client_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS wallet_merchant_number_seq START 1;

CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_number VARCHAR(20) UNIQUE NOT NULL,
  currency VARCHAR(10) DEFAULT 'CDF',
  status VARCHAR(20) DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Server-generated, atomic (sequence-backed), format:
--   LP-00001234      for regular accounts
--   LP-MER-000458     for accounts that own a merchant
CREATE OR REPLACE FUNCTION public.generate_wallet_number(p_user_id UUID)
RETURNS VARCHAR AS $$
DECLARE
  v_is_merchant BOOLEAN;
  v_seq BIGINT;
BEGIN
  SELECT EXISTS(SELECT 1 FROM merchants WHERE owner_id = p_user_id) INTO v_is_merchant;
  IF v_is_merchant THEN
    v_seq := nextval('wallet_merchant_number_seq');
    RETURN 'LP-MER-' || lpad(v_seq::text, 6, '0');
  ELSE
    v_seq := nextval('wallet_client_number_seq');
    RETURN 'LP-' || lpad(v_seq::text, 8, '0');
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.set_wallet_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.wallet_number IS NULL THEN
    NEW.wallet_number := public.generate_wallet_number(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_wallet_number ON wallets;
CREATE TRIGGER trg_set_wallet_number
  BEFORE INSERT ON wallets
  FOR EACH ROW
  EXECUTE FUNCTION public.set_wallet_number();

-- ----------------------------------------------------------------------------
-- ledger_entries: generalize to also hold wallet-scoped entries
-- ----------------------------------------------------------------------------
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS wallet_id UUID REFERENCES wallets(id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_wallet_id ON ledger_entries(wallet_id);

ALTER TYPE ledger_entry_type ADD VALUE IF NOT EXISTS 'TOPUP';

-- Explicit commit so the 'TOPUP' enum value just added above is usable by
-- the statements below, in this same script — Postgres forbids using a
-- brand-new enum value within the transaction that added it.
COMMIT;


-- ----------------------------------------------------------------------------
-- wallet_topups — same proven shape as payment_intents
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallet_topups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency VARCHAR(10) DEFAULT 'CDF',
  status VARCHAR(20) DEFAULT 'PENDING',
  psp_provider VARCHAR(50),
  psp_intent_id VARCHAR(255),
  idempotency_key VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_topups_wallet_id ON wallet_topups(wallet_id);

-- ----------------------------------------------------------------------------
-- credit_wallet / debit_wallet — the ONLY sanctioned way to move a wallet's
-- balance. Runs atomically inside Postgres (a single function call is one
-- transaction); FOR UPDATE row-locks the wallet so concurrent calls on the
-- same wallet serialize instead of racing past a stale balance read.
-- Not granted to anon/authenticated — only the backend's service_role key
-- may call these (see REVOKE/GRANT below).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.credit_wallet(
  p_wallet_id UUID,
  p_amount_cents BIGINT,
  p_entry_type ledger_entry_type,
  p_reference VARCHAR,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS BIGINT
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_currency VARCHAR;
  v_balance BIGINT;
BEGIN
  IF p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'amount_cents must be positive';
  END IF;

  SELECT currency INTO v_currency FROM wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet % not found', p_wallet_id;
  END IF;

  INSERT INTO ledger_entries (wallet_id, entry_type, direction, amount_cents, currency, reference, source, metadata)
  VALUES (p_wallet_id, p_entry_type, 'credit', p_amount_cents, v_currency, p_reference, 'system', p_metadata);

  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END), 0)
    INTO v_balance
    FROM ledger_entries WHERE wallet_id = p_wallet_id;

  RETURN v_balance;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.debit_wallet(
  p_wallet_id UUID,
  p_amount_cents BIGINT,
  p_entry_type ledger_entry_type,
  p_reference VARCHAR,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS BIGINT
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_currency VARCHAR;
  v_balance BIGINT;
BEGIN
  IF p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'amount_cents must be positive';
  END IF;

  SELECT currency INTO v_currency FROM wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet % not found', p_wallet_id;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END), 0)
    INTO v_balance
    FROM ledger_entries WHERE wallet_id = p_wallet_id;

  IF v_balance < p_amount_cents THEN
    RAISE EXCEPTION 'Insufficient balance: has %, needs %', v_balance, p_amount_cents;
  END IF;

  INSERT INTO ledger_entries (wallet_id, entry_type, direction, amount_cents, currency, reference, source, metadata)
  VALUES (p_wallet_id, p_entry_type, 'debit', p_amount_cents, v_currency, p_reference, 'system', p_metadata);

  RETURN v_balance - p_amount_cents;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.credit_wallet(UUID, BIGINT, ledger_entry_type, VARCHAR, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.debit_wallet(UUID, BIGINT, ledger_entry_type, VARCHAR, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.credit_wallet(UUID, BIGINT, ledger_entry_type, VARCHAR, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.debit_wallet(UUID, BIGINT, ledger_entry_type, VARCHAR, JSONB) TO service_role;

-- ----------------------------------------------------------------------------
-- Backfill: give every existing non-admin account a wallet
-- ----------------------------------------------------------------------------
INSERT INTO wallets (user_id)
SELECT p.id
FROM profiles p
LEFT JOIN wallets w ON w.user_id = p.id
WHERE w.id IS NULL
  AND p.id NOT IN (
    SELECT ur.user_id FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE r.slug IN ('admin', 'super_admin')
  );

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wallets_select_own ON wallets;
CREATE POLICY wallets_select_own ON wallets FOR SELECT USING (
  auth.uid() = user_id OR public.is_admin()
);

ALTER TABLE wallet_topups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wallet_topups_select_own ON wallet_topups;
CREATE POLICY wallet_topups_select_own ON wallet_topups FOR SELECT USING (
  auth.uid() IN (SELECT user_id FROM wallets WHERE id = wallet_topups.wallet_id) OR public.is_admin()
);

-- Additive policy — the pre-existing ledger_entries_admin_only policy stays;
-- Postgres OR-combines permissive policies, so this only adds visibility,
-- it doesn't remove the admin one.
DROP POLICY IF EXISTS ledger_entries_select_own_wallet ON ledger_entries;
CREATE POLICY ledger_entries_select_own_wallet ON ledger_entries FOR SELECT USING (
  wallet_id IS NOT NULL AND auth.uid() IN (SELECT user_id FROM wallets WHERE id = ledger_entries.wallet_id)
);

-- ----------------------------------------------------------------------------
-- Realtime
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE wallets;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE wallet_topups;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- Source: migrations/007_wallet_phase2.sql
-- ============================================================================
-- ============================================================================
-- 007_wallet_phase2.sql — LinkPay Wallet, Phase 2
-- (PIN de transaction, transfert P2P, retrait, limites configurables)
-- Run once in the Supabase SQL editor, same as previous migrations.
--
-- Builds on 006_wallets.sql (wallets, wallet_topups, credit_wallet/
-- debit_wallet). Reuses the existing commission_rules/CommissionsService and
-- payment_requests/payment_intents/transactions pipeline for wallet-based
-- invoice payment instead of duplicating it (see PaymentsService.payWithWallet).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Transaction PIN — never stored in clear, only a bcrypt hash. Lockout after
-- repeated failures (5 attempts -> 15 min lock), enforced server-side.
-- ----------------------------------------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS transaction_pin_hash TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pin_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- New ledger entry types for transfers/withdrawals (TOPUP and the original
-- 6 values already exist from 001/006). PAYMENT and ADJUSTMENT are reused
-- for wallet invoice-payment debits and withdrawal restitution credits.
-- ----------------------------------------------------------------------------
ALTER TYPE ledger_entry_type ADD VALUE IF NOT EXISTS 'TRANSFER_OUT';
ALTER TYPE ledger_entry_type ADD VALUE IF NOT EXISTS 'TRANSFER_IN';
ALTER TYPE ledger_entry_type ADD VALUE IF NOT EXISTS 'WITHDRAWAL';

-- Same reason as above: commit before using TRANSFER_OUT/TRANSFER_IN/WITHDRAWAL.
COMMIT;


-- ----------------------------------------------------------------------------
-- transfers — user-to-user, by LinkPay number
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transfers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_wallet_id UUID NOT NULL REFERENCES wallets(id),
  recipient_wallet_id UUID NOT NULL REFERENCES wallets(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  fee_cents BIGINT NOT NULL DEFAULT 0,
  currency VARCHAR(10) DEFAULT 'CDF',
  status VARCHAR(20) DEFAULT 'PENDING', -- PENDING | SUCCESS | FAILED
  description TEXT,
  failure_reason TEXT,
  idempotency_key VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT transfers_not_to_self CHECK (sender_wallet_id <> recipient_wallet_id)
);
CREATE INDEX IF NOT EXISTS idx_transfers_sender ON transfers(sender_wallet_id);
CREATE INDEX IF NOT EXISTS idx_transfers_recipient ON transfers(recipient_wallet_id);

-- ----------------------------------------------------------------------------
-- withdrawals — wallet -> Mobile Money / bank (demo: mock settlement only,
-- no real payout PSP is integrated yet; see WalletsService.requestWithdrawal)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS withdrawals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  fee_cents BIGINT NOT NULL DEFAULT 0,
  currency VARCHAR(10) DEFAULT 'CDF',
  channel VARCHAR(30) NOT NULL, -- mobile_money | bank
  destination JSONB NOT NULL DEFAULT '{}'::jsonb, -- {operator, phone} or {bank, account_number, account_name}
  status VARCHAR(20) DEFAULT 'PENDING', -- PENDING|PROCESSING|SUCCESS|FAILED|CANCELLED|REVERSED
  psp_provider VARCHAR(50),
  psp_reference VARCHAR(255),
  failure_reason TEXT,
  idempotency_key VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_wallet_id ON withdrawals(wallet_id);

-- ----------------------------------------------------------------------------
-- wallet_limits — configurable per operation type, never hardcoded in the
-- frontend or in application code. One global row per op_type by default
-- (applies_to = 'all'); a future per-user override could add a row with
-- applies_to = 'user' + user_id, checked preferentially — not built yet,
-- kept simple for Phase 2.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallet_limits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  op_type VARCHAR(30) NOT NULL, -- TRANSFER | WITHDRAWAL | WALLET_PAYMENT
  applies_to VARCHAR(20) NOT NULL DEFAULT 'all',
  min_cents BIGINT NOT NULL DEFAULT 100,
  max_cents BIGINT, -- per-operation cap, NULL = no cap
  daily_max_cents BIGINT, -- NULL = no cap
  monthly_max_cents BIGINT, -- NULL = no cap
  fee_percent NUMERIC(6, 4) NOT NULL DEFAULT 0, -- e.g. 0.01 = 1%
  fee_fixed_cents BIGINT NOT NULL DEFAULT 0,
  currency VARCHAR(10) DEFAULT 'CDF',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (op_type, applies_to, currency)
);

-- Sane defaults for demo/dev — real values should be tuned by an admin
-- before any public launch, per KYC tier etc. (documented backlog item).
INSERT INTO wallet_limits (op_type, min_cents, max_cents, daily_max_cents, monthly_max_cents, fee_percent, fee_fixed_cents)
VALUES
  ('TRANSFER', 100, 500000000, 1000000000, 10000000000, 0, 0),
  ('WITHDRAWAL', 100, 500000000, 500000000, 5000000000, 0.01, 0),
  ('WALLET_PAYMENT', 100, 500000000, NULL, NULL, 0, 0)
ON CONFLICT (op_type, applies_to, currency) DO NOTHING;

-- ----------------------------------------------------------------------------
-- transfer_wallet — the ONLY sanctioned way to move money between two
-- wallets. Re-reads the already-created `transfers` PENDING row (created by
-- the backend right after the idempotency check, so a retry with the same
-- Idempotency-Key never re-executes this) and settles it atomically: locks
-- both wallets in a fixed order (by id) to prevent deadlocks between two
-- concurrent transfers going in opposite directions, verifies the sender's
-- real balance, writes both ledger entries, marks the transfer SUCCESS or
-- raises (caller marks it FAILED). SECURITY DEFINER + service_role-only,
-- same posture as credit_wallet/debit_wallet.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_wallet(p_transfer_id UUID)
RETURNS TABLE (sender_balance BIGINT, recipient_balance BIGINT)
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transfer RECORD;
  v_first UUID;
  v_second UUID;
  v_sender_balance BIGINT;
  v_sender_status VARCHAR;
  v_recipient_status VARCHAR;
BEGIN
  SELECT * INTO v_transfer FROM transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer % not found', p_transfer_id;
  END IF;
  IF v_transfer.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Transfer % is not PENDING (status: %)', p_transfer_id, v_transfer.status;
  END IF;

  -- Lock both wallets in a stable order regardless of who is sender/recipient
  -- (prevents deadlock against a concurrent transfer going the other way).
  IF v_transfer.sender_wallet_id < v_transfer.recipient_wallet_id THEN
    v_first := v_transfer.sender_wallet_id;
    v_second := v_transfer.recipient_wallet_id;
  ELSE
    v_first := v_transfer.recipient_wallet_id;
    v_second := v_transfer.sender_wallet_id;
  END IF;

  PERFORM 1 FROM wallets WHERE id = v_first FOR UPDATE;
  PERFORM 1 FROM wallets WHERE id = v_second FOR UPDATE;

  SELECT status INTO v_sender_status FROM wallets WHERE id = v_transfer.sender_wallet_id;
  SELECT status INTO v_recipient_status FROM wallets WHERE id = v_transfer.recipient_wallet_id;

  IF v_sender_status IS NULL OR v_recipient_status IS NULL THEN
    RAISE EXCEPTION 'Sender or recipient wallet not found';
  END IF;
  -- Note: none of the RAISE EXCEPTION calls below are preceded by an UPDATE
  -- marking the transfer FAILED — a raised exception rolls back everything
  -- this function has done so far, including such an UPDATE, since it all
  -- runs in the same transaction. Marking the row FAILED (with a reason) is
  -- done by the caller (WalletsService.transfer()) once the RPC call itself
  -- has failed, after this transaction has already been rolled back.
  IF v_sender_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'SENDER_WALLET_%', v_sender_status;
  END IF;
  IF v_recipient_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'RECIPIENT_WALLET_%', v_recipient_status;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END), 0)
    INTO v_sender_balance
    FROM ledger_entries WHERE wallet_id = v_transfer.sender_wallet_id;

  IF v_sender_balance < (v_transfer.amount_cents + v_transfer.fee_cents) THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE: has %, needs %', v_sender_balance, v_transfer.amount_cents + v_transfer.fee_cents;
  END IF;

  INSERT INTO ledger_entries (wallet_id, entry_type, direction, amount_cents, currency, reference, source, metadata)
  VALUES (
    v_transfer.sender_wallet_id, 'TRANSFER_OUT', 'debit', v_transfer.amount_cents + v_transfer.fee_cents,
    v_transfer.currency, 'TRANSFER-' || v_transfer.id, 'system',
    jsonb_build_object('transfer_id', v_transfer.id, 'counterparty_wallet_id', v_transfer.recipient_wallet_id)
  );

  INSERT INTO ledger_entries (wallet_id, entry_type, direction, amount_cents, currency, reference, source, metadata)
  VALUES (
    v_transfer.recipient_wallet_id, 'TRANSFER_IN', 'credit', v_transfer.amount_cents,
    v_transfer.currency, 'TRANSFER-' || v_transfer.id, 'system',
    jsonb_build_object('transfer_id', v_transfer.id, 'counterparty_wallet_id', v_transfer.sender_wallet_id)
  );

  UPDATE transfers SET status = 'SUCCESS', updated_at = NOW() WHERE id = p_transfer_id;

  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END), 0) INTO sender_balance
    FROM ledger_entries WHERE wallet_id = v_transfer.sender_wallet_id;
  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END), 0) INTO recipient_balance
    FROM ledger_entries WHERE wallet_id = v_transfer.recipient_wallet_id;

  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.transfer_wallet(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_wallet(UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
ALTER TABLE transfers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS transfers_select_own ON transfers;
CREATE POLICY transfers_select_own ON transfers FOR SELECT USING (
  auth.uid() IN (SELECT user_id FROM wallets WHERE id IN (transfers.sender_wallet_id, transfers.recipient_wallet_id))
  OR public.is_admin()
);

ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS withdrawals_select_own ON withdrawals;
CREATE POLICY withdrawals_select_own ON withdrawals FOR SELECT USING (
  auth.uid() IN (SELECT user_id FROM wallets WHERE id = withdrawals.wallet_id) OR public.is_admin()
);

ALTER TABLE wallet_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wallet_limits_admin_only ON wallet_limits;
CREATE POLICY wallet_limits_admin_only ON wallet_limits FOR SELECT USING (public.is_admin());

-- ----------------------------------------------------------------------------
-- Realtime
-- ----------------------------------------------------------------------------
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE transfers; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE withdrawals; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- Source: migrations/008_multi_currency.sql
-- ============================================================================
-- ============================================================================
-- 008_multi_currency.sql — LinkPay Multi-Currency (CDF/FC + USD)
-- Run once in the Supabase SQL editor, same as previous migrations.
--
-- Every currency balance is fully independent — NO automatic conversion
-- anywhere in this system. An operation in USD only ever checks/moves the
-- USD balance; same for CDF. No exchange-rate infrastructure is introduced
-- here (none existed before this migration either).
--
-- No new "wallet_balances" table: ledger_entries already carries its own
-- `currency` per row, so a wallet's balance-per-currency is just that same
-- SUM query with an added `AND currency = ...` filter (see the RPC changes
-- and WalletsService.getBalances() below).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- merchants: a default currency for new payment links (still overridable per
-- link at creation time).
-- ----------------------------------------------------------------------------
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS default_currency VARCHAR(10) NOT NULL DEFAULT 'CDF';

-- ----------------------------------------------------------------------------
-- CHECK constraints (not a Postgres ENUM — see plan notes: 11 existing
-- VARCHAR(10) currency columns across the schema, converting them all to a
-- shared enum type is a high-risk single-shot ALTER COLUMN ... TYPE ... USING
-- with no rollback safety net in this hand-run-migration setup. A CHECK
-- constraint gives the same guarantee, additively, per table.
-- ----------------------------------------------------------------------------
ALTER TABLE merchants ADD CONSTRAINT merchants_default_currency_check CHECK (default_currency IN ('CDF','USD'));
ALTER TABLE wallets ADD CONSTRAINT wallets_currency_check CHECK (currency IN ('CDF','USD'));
ALTER TABLE wallet_topups ADD CONSTRAINT wallet_topups_currency_check CHECK (currency IN ('CDF','USD'));
ALTER TABLE transfers ADD CONSTRAINT transfers_currency_check CHECK (currency IN ('CDF','USD'));
ALTER TABLE withdrawals ADD CONSTRAINT withdrawals_currency_check CHECK (currency IN ('CDF','USD'));
ALTER TABLE wallet_limits ADD CONSTRAINT wallet_limits_currency_check CHECK (currency IN ('CDF','USD'));
ALTER TABLE commission_rules ADD CONSTRAINT commission_rules_currency_check CHECK (currency IN ('CDF','USD'));
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_currency_check CHECK (currency IN ('CDF','USD'));
ALTER TABLE payment_intents ADD CONSTRAINT payment_intents_currency_check CHECK (currency IN ('CDF','USD'));
ALTER TABLE settlements ADD CONSTRAINT settlements_currency_check CHECK (currency IN ('CDF','USD'));

-- Larger/hotter tables: validate without holding a long lock on every row up front.
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_currency_check CHECK (currency IN ('CDF','USD')) NOT VALID;
ALTER TABLE ledger_entries VALIDATE CONSTRAINT ledger_entries_currency_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_currency_check CHECK (currency IN ('CDF','USD')) NOT VALID;
ALTER TABLE transactions VALIDATE CONSTRAINT transactions_currency_check;

-- Supports the new per-(wallet, currency) balance queries.
CREATE INDEX IF NOT EXISTS idx_ledger_entries_wallet_currency ON ledger_entries(wallet_id, currency);

-- ----------------------------------------------------------------------------
-- credit_wallet / debit_wallet — must be dropped first: CREATE OR REPLACE
-- FUNCTION does NOT replace a function when the argument list changes, it
-- creates an ambiguous second overload instead. Both now take an explicit
-- p_currency and only ever look at ledger_entries in that currency.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.credit_wallet(UUID, BIGINT, ledger_entry_type, VARCHAR, JSONB);
DROP FUNCTION IF EXISTS public.debit_wallet(UUID, BIGINT, ledger_entry_type, VARCHAR, JSONB);

CREATE OR REPLACE FUNCTION public.credit_wallet(
  p_wallet_id UUID,
  p_amount_cents BIGINT,
  p_entry_type ledger_entry_type,
  p_reference VARCHAR,
  p_currency VARCHAR,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS BIGINT
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance BIGINT;
BEGIN
  IF p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'amount_cents must be positive';
  END IF;
  IF p_currency NOT IN ('CDF', 'USD') THEN
    RAISE EXCEPTION 'INVALID_CURRENCY: %', p_currency;
  END IF;

  PERFORM 1 FROM wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet % not found', p_wallet_id;
  END IF;

  INSERT INTO ledger_entries (wallet_id, entry_type, direction, amount_cents, currency, reference, source, metadata)
  VALUES (p_wallet_id, p_entry_type, 'credit', p_amount_cents, p_currency, p_reference, 'system', p_metadata);

  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END), 0)
    INTO v_balance
    FROM ledger_entries WHERE wallet_id = p_wallet_id AND currency = p_currency;

  RETURN v_balance;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.debit_wallet(
  p_wallet_id UUID,
  p_amount_cents BIGINT,
  p_entry_type ledger_entry_type,
  p_reference VARCHAR,
  p_currency VARCHAR,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS BIGINT
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance BIGINT;
BEGIN
  IF p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'amount_cents must be positive';
  END IF;
  IF p_currency NOT IN ('CDF', 'USD') THEN
    RAISE EXCEPTION 'INVALID_CURRENCY: %', p_currency;
  END IF;

  PERFORM 1 FROM wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet % not found', p_wallet_id;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END), 0)
    INTO v_balance
    FROM ledger_entries WHERE wallet_id = p_wallet_id AND currency = p_currency;

  IF v_balance < p_amount_cents THEN
    RAISE EXCEPTION 'Insufficient balance: has %, needs % (currency %)', v_balance, p_amount_cents, p_currency;
  END IF;

  INSERT INTO ledger_entries (wallet_id, entry_type, direction, amount_cents, currency, reference, source, metadata)
  VALUES (p_wallet_id, p_entry_type, 'debit', p_amount_cents, p_currency, p_reference, 'system', p_metadata);

  RETURN v_balance - p_amount_cents;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.credit_wallet(UUID, BIGINT, ledger_entry_type, VARCHAR, VARCHAR, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.debit_wallet(UUID, BIGINT, ledger_entry_type, VARCHAR, VARCHAR, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.credit_wallet(UUID, BIGINT, ledger_entry_type, VARCHAR, VARCHAR, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.debit_wallet(UUID, BIGINT, ledger_entry_type, VARCHAR, VARCHAR, JSONB) TO service_role;

-- ----------------------------------------------------------------------------
-- transfer_wallet — signature unchanged (currency already lives on the
-- transfers row itself), but its 3 internal balance queries previously
-- summed ALL currencies for a wallet together. Fixed to filter by the
-- transfer's own currency.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_wallet(p_transfer_id UUID)
RETURNS TABLE (sender_balance BIGINT, recipient_balance BIGINT)
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transfer RECORD;
  v_first UUID;
  v_second UUID;
  v_sender_balance BIGINT;
  v_sender_status VARCHAR;
  v_recipient_status VARCHAR;
BEGIN
  SELECT * INTO v_transfer FROM transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer % not found', p_transfer_id;
  END IF;
  IF v_transfer.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Transfer % is not PENDING (status: %)', p_transfer_id, v_transfer.status;
  END IF;
  IF v_transfer.currency NOT IN ('CDF', 'USD') THEN
    RAISE EXCEPTION 'INVALID_CURRENCY: %', v_transfer.currency;
  END IF;

  IF v_transfer.sender_wallet_id < v_transfer.recipient_wallet_id THEN
    v_first := v_transfer.sender_wallet_id;
    v_second := v_transfer.recipient_wallet_id;
  ELSE
    v_first := v_transfer.recipient_wallet_id;
    v_second := v_transfer.sender_wallet_id;
  END IF;

  PERFORM 1 FROM wallets WHERE id = v_first FOR UPDATE;
  PERFORM 1 FROM wallets WHERE id = v_second FOR UPDATE;

  SELECT status INTO v_sender_status FROM wallets WHERE id = v_transfer.sender_wallet_id;
  SELECT status INTO v_recipient_status FROM wallets WHERE id = v_transfer.recipient_wallet_id;

  IF v_sender_status IS NULL OR v_recipient_status IS NULL THEN
    RAISE EXCEPTION 'Sender or recipient wallet not found';
  END IF;
  IF v_sender_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'SENDER_WALLET_%', v_sender_status;
  END IF;
  IF v_recipient_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'RECIPIENT_WALLET_%', v_recipient_status;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END), 0)
    INTO v_sender_balance
    FROM ledger_entries WHERE wallet_id = v_transfer.sender_wallet_id AND currency = v_transfer.currency;

  IF v_sender_balance < (v_transfer.amount_cents + v_transfer.fee_cents) THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE: has %, needs %', v_sender_balance, v_transfer.amount_cents + v_transfer.fee_cents;
  END IF;

  INSERT INTO ledger_entries (wallet_id, entry_type, direction, amount_cents, currency, reference, source, metadata)
  VALUES (
    v_transfer.sender_wallet_id, 'TRANSFER_OUT', 'debit', v_transfer.amount_cents + v_transfer.fee_cents,
    v_transfer.currency, 'TRANSFER-' || v_transfer.id, 'system',
    jsonb_build_object('transfer_id', v_transfer.id, 'counterparty_wallet_id', v_transfer.recipient_wallet_id)
  );

  INSERT INTO ledger_entries (wallet_id, entry_type, direction, amount_cents, currency, reference, source, metadata)
  VALUES (
    v_transfer.recipient_wallet_id, 'TRANSFER_IN', 'credit', v_transfer.amount_cents,
    v_transfer.currency, 'TRANSFER-' || v_transfer.id, 'system',
    jsonb_build_object('transfer_id', v_transfer.id, 'counterparty_wallet_id', v_transfer.sender_wallet_id)
  );

  UPDATE transfers SET status = 'SUCCESS', updated_at = NOW() WHERE id = p_transfer_id;

  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END), 0) INTO sender_balance
    FROM ledger_entries WHERE wallet_id = v_transfer.sender_wallet_id AND currency = v_transfer.currency;
  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END), 0) INTO recipient_balance
    FROM ledger_entries WHERE wallet_id = v_transfer.recipient_wallet_id AND currency = v_transfer.currency;

  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- wallet_limits: USD row per op_type, independent demo numbers (NOT derived
-- from any exchange rate — none exists). Mirrors each CDF row's fee shape.
-- ----------------------------------------------------------------------------
INSERT INTO wallet_limits (op_type, currency, min_cents, max_cents, daily_max_cents, monthly_max_cents, fee_percent, fee_fixed_cents)
VALUES
  ('TRANSFER', 'USD', 100, 200000, 500000, 5000000, 0, 0),
  ('WITHDRAWAL', 'USD', 100, 200000, 200000, 2000000, 0.01, 0),
  ('WALLET_PAYMENT', 'USD', 100, 200000, NULL, NULL, 0, 0)
ON CONFLICT (op_type, applies_to, currency) DO NOTHING;

-- ----------------------------------------------------------------------------
-- commission_rules: one global USD rule, mirroring the existing CDF one's
-- shape with independent USD-appropriate bounds on the commission itself.
-- ----------------------------------------------------------------------------
INSERT INTO commission_rules (name, description, percent, fixed_cents, min_cents, max_cents, applies_to, currency, version, is_active, valid_from)
SELECT 'Standard USD 2.5%', 'Règle globale par défaut (USD)', '0.0250', 0, 5, 10000, 'all', 'USD', 1, TRUE, NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM commission_rules WHERE applies_to = 'all' AND currency = 'USD' AND is_active = TRUE
);

-- ============================================================================
-- Source: migrations/009_device_binding.sql
-- ============================================================================
-- ============================================================================
-- 009_device_binding.sql — same-device session reclaim
-- Run once in the Supabase SQL editor, same as previous migrations.
--
-- Pairs with active_session_id (005_session_tracking.sql). Lets a device
-- that already holds a session silently reclaim it on a fresh login (e.g.
-- its stored tokens were lost to a network blip, not an explicit logout)
-- without the single-active-session conflict — while a genuinely different
-- device is still blocked exactly as before (409, admin reset required).
-- ============================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS active_device_id TEXT;

-- ============================================================================
-- Source: migrations/010_push_subscriptions.sql
-- ============================================================================
-- ============================================================================
-- 010_push_subscriptions.sql — Web Push (VAPID) subscription storage
-- Run once in the Supabase SQL editor, same as previous migrations.
--
-- One row per browser/device push registration. `endpoint` is the push
-- service's per-registration URL and is already globally unique on the web
-- (it isn't scoped to LinkPay) — used as the natural conflict target so a
-- device re-subscribing (e.g. after clearing storage, or logging into a
-- different LinkPay account on the same browser) upserts in place instead
-- of erroring or leaving stale duplicate rows.
-- ============================================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);

-- ----------------------------------------------------------------------------
-- RLS — safety net only; the NestJS backend always uses the Supabase
-- service-role key (bypasses RLS) via SupabaseService, same as every other
-- table in this project.
-- ----------------------------------------------------------------------------
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_subscriptions_select_own ON push_subscriptions;
CREATE POLICY push_subscriptions_select_own ON push_subscriptions FOR SELECT USING (
  auth.uid() = user_id OR public.is_admin()
);

DROP POLICY IF EXISTS push_subscriptions_insert_own ON push_subscriptions;
CREATE POLICY push_subscriptions_insert_own ON push_subscriptions FOR INSERT WITH CHECK (
  auth.uid() = user_id
);

DROP POLICY IF EXISTS push_subscriptions_delete_own ON push_subscriptions;
CREATE POLICY push_subscriptions_delete_own ON push_subscriptions FOR DELETE USING (
  auth.uid() = user_id OR public.is_admin()
);

-- ============================================================================
-- Source: migrations/011_webauthn_credentials.sql
-- ============================================================================
-- ============================================================================
-- 011_webauthn_credentials.sql — WebAuthn platform authenticator credentials
-- Run once in the Supabase SQL editor, same as previous migrations.
--
-- One row per registered platform authenticator (Windows Hello, Android
-- fingerprint/face, iOS Touch/Face ID) — inherently per-device, mirroring
-- push_subscriptions' one-row-per-registration shape (010_push_subscriptions.sql).
-- Used exclusively by the optional app-lock feature (Settings toggle): it
-- re-locks the UI on open/resume even though the underlying JWT session
-- stays valid — it is not a login mechanism.
-- ============================================================================

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,       -- base64url, from the authenticator
  public_key TEXT NOT NULL,                 -- base64url-encoded COSE public key
  counter BIGINT NOT NULL DEFAULT 0,        -- signature counter, replay protection
  device_name TEXT,                         -- user-agent-derived label, e.g. "Chrome sur Windows"
  transports TEXT[],                        -- e.g. {internal}
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user_id ON webauthn_credentials(user_id);

-- ----------------------------------------------------------------------------
-- RLS — safety net only; the NestJS backend always uses the Supabase
-- service-role key (bypasses RLS) via SupabaseService, same as every other
-- table in this project.
-- ----------------------------------------------------------------------------
ALTER TABLE webauthn_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webauthn_credentials_select_own ON webauthn_credentials;
CREATE POLICY webauthn_credentials_select_own ON webauthn_credentials FOR SELECT USING (
  auth.uid() = user_id OR public.is_admin()
);

DROP POLICY IF EXISTS webauthn_credentials_insert_own ON webauthn_credentials;
CREATE POLICY webauthn_credentials_insert_own ON webauthn_credentials FOR INSERT WITH CHECK (
  auth.uid() = user_id
);

DROP POLICY IF EXISTS webauthn_credentials_delete_own ON webauthn_credentials;
CREATE POLICY webauthn_credentials_delete_own ON webauthn_credentials FOR DELETE USING (
  auth.uid() = user_id OR public.is_admin()
);

-- ============================================================================
-- Source: migrations/012_fcm_push_tokens.sql
-- ============================================================================
-- ============================================================================
-- 012_fcm_push_tokens.sql — Firebase Cloud Messaging support on
-- push_subscriptions, alongside the existing Web Push (VAPID) rows.
--
-- The Capacitor Android app can't receive Web Push in its WebView — it
-- registers an FCM token instead. Rather than a parallel table, this adds a
-- `platform` discriminator + `fcm_token` column to the existing table, so
-- NotificationsService's single sendPush() fan-out just branches per row.
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

ALTER TABLE push_subscriptions
  ALTER COLUMN endpoint DROP NOT NULL,
  ALTER COLUMN p256dh DROP NOT NULL,
  ALTER COLUMN auth DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS fcm_token TEXT UNIQUE;

ALTER TABLE push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_platform_fields_chk;
ALTER TABLE push_subscriptions
  ADD CONSTRAINT push_subscriptions_platform_fields_chk CHECK (
    (platform = 'web' AND endpoint IS NOT NULL AND p256dh IS NOT NULL AND auth IS NOT NULL)
    OR (platform = 'android' AND fcm_token IS NOT NULL)
  );

-- ============================================================================
-- Source: migrations/013_qr_codes_bucket.sql
-- ============================================================================
-- ============================================================================
-- 013_qr_codes_bucket.sql — Creates the 'qr-codes' Storage bucket.
--
-- payment-requests.service.ts has always uploaded generated QR PNGs to a
-- bucket named 'qr-codes', but it was never actually created — every upload
-- has been silently failing (qr_code_url stays undefined, no QR shown on
-- the merchant's "Demande créée !" screen). Public read, since the QR image
-- is rendered via a plain <img src> with no auth.
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('qr-codes', 'qr-codes', true)
on conflict (id) do nothing;

drop policy if exists "Public read access to qr-codes" on storage.objects;
create policy "Public read access to qr-codes"
  on storage.objects for select
  using (bucket_id = 'qr-codes');

-- ============================================================================
-- Source: migrations/014_organization_merchants.sql
-- ============================================================================
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

-- ============================================================================
-- Source: migrations/015_slp_wallet_numbers.sql
-- ============================================================================
-- ============================================================================
-- 015_slp_wallet_numbers.sql — Rebrand wallet number prefix LP- → SLP-
-- (LinkPay → ScanLinkPay).
--
-- Existing wallets keep their "LP-..."/"LP-MER-..." numbers permanently —
-- a live account identifier already shared with its owner is never
-- silently renamed. Only wallets created from here on get "SLP-"/
-- "SLP-MER-". Same sequences (wallet_client_number_seq /
-- wallet_merchant_number_seq), numbering just continues — not reset.
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.generate_wallet_number(p_user_id UUID)
RETURNS VARCHAR AS $$
DECLARE
  v_is_merchant BOOLEAN;
  v_seq BIGINT;
BEGIN
  SELECT EXISTS(SELECT 1 FROM merchants WHERE owner_id = p_user_id) INTO v_is_merchant;
  IF v_is_merchant THEN
    v_seq := nextval('wallet_merchant_number_seq');
    RETURN 'SLP-MER-' || lpad(v_seq::text, 6, '0');
  ELSE
    v_seq := nextval('wallet_client_number_seq');
    RETURN 'SLP-' || lpad(v_seq::text, 8, '0');
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Source: migrations/016_tontines.sql
-- ============================================================================
-- ============================================================================
-- 016_tontines.sql — Digital tontine/likelemba: rotating savings groups.
--
-- No group wallet holds money. Each cycle's contribution is a direct
-- wallet-to-wallet transfer (see wallets.service.ts transfer()) from a
-- member straight to that cycle's recipient — this table set only tracks
-- who owes what to whom and by when; the money movement itself reuses the
-- existing transfers table/RPC untouched. Run once in the Supabase SQL
-- editor, same as previous migrations.
-- ============================================================================

CREATE TABLE IF NOT EXISTS tontine_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  creator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contribution_amount_cents BIGINT NOT NULL CHECK (contribution_amount_cents > 0),
  currency VARCHAR(10) NOT NULL DEFAULT 'CDF',
  frequency VARCHAR(20) NOT NULL DEFAULT 'monthly', -- 'weekly' | 'monthly'
  max_members INT NOT NULL CHECK (max_members BETWEEN 3 AND 30),
  grace_period_days INT NOT NULL DEFAULT 3,
  status VARCHAR(20) NOT NULL DEFAULT 'forming', -- forming | active | completed | cancelled
  current_cycle INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tontine_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID NOT NULL REFERENCES tontine_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  join_order INT NOT NULL,
  payout_position INT, -- set by the random draw; NULL until the group is full
  status VARCHAR(20) NOT NULL DEFAULT 'invited', -- invited | active | declined | left
  invited_at TIMESTAMPTZ DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  UNIQUE (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS tontine_cycles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID NOT NULL REFERENCES tontine_groups(id) ON DELETE CASCADE,
  cycle_number INT NOT NULL,
  recipient_member_id UUID NOT NULL REFERENCES tontine_members(id),
  due_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- active | completed
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (group_id, cycle_number)
);

-- One row per non-recipient member per cycle — the ower.
CREATE TABLE IF NOT EXISTS tontine_contributions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cycle_id UUID NOT NULL REFERENCES tontine_cycles(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES tontine_groups(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES tontine_members(id),
  amount_cents BIGINT NOT NULL,
  currency VARCHAR(10) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | paid | overdue
  transfer_id UUID REFERENCES transfers(id),
  due_date DATE NOT NULL,
  paid_at TIMESTAMPTZ,
  reminder_sent_at TIMESTAMPTZ,
  overdue_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (cycle_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_tontine_members_group ON tontine_members(group_id);
CREATE INDEX IF NOT EXISTS idx_tontine_members_user ON tontine_members(user_id);
CREATE INDEX IF NOT EXISTS idx_tontine_contributions_status_due ON tontine_contributions(status, due_date);
CREATE INDEX IF NOT EXISTS idx_tontine_contributions_member ON tontine_contributions(member_id);
CREATE INDEX IF NOT EXISTS idx_tontine_cycles_group ON tontine_cycles(group_id);

-- ----------------------------------------------------------------------------
-- RLS — safety net only; the NestJS backend always uses the service-role
-- key (bypasses RLS) via SupabaseService, same as every other table here.
-- ----------------------------------------------------------------------------
ALTER TABLE tontine_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE tontine_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE tontine_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tontine_contributions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_tontine_member(group_uuid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS(
    SELECT 1 FROM tontine_members WHERE group_id = group_uuid AND user_id = auth.uid()
  )
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

DROP POLICY IF EXISTS tontine_groups_select_member ON tontine_groups;
CREATE POLICY tontine_groups_select_member ON tontine_groups FOR SELECT USING (
  auth.uid() = creator_id OR public.is_tontine_member(id) OR public.is_admin()
);

DROP POLICY IF EXISTS tontine_members_select_member ON tontine_members;
CREATE POLICY tontine_members_select_member ON tontine_members FOR SELECT USING (
  public.is_tontine_member(group_id) OR public.is_admin()
);

DROP POLICY IF EXISTS tontine_cycles_select_member ON tontine_cycles;
CREATE POLICY tontine_cycles_select_member ON tontine_cycles FOR SELECT USING (
  public.is_tontine_member(group_id) OR public.is_admin()
);

DROP POLICY IF EXISTS tontine_contributions_select_member ON tontine_contributions;
CREATE POLICY tontine_contributions_select_member ON tontine_contributions FOR SELECT USING (
  public.is_tontine_member(group_id) OR public.is_admin()
);

-- Live "who has paid this cycle" updates on the frontend.
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE tontine_groups; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE tontine_members; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE tontine_cycles; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE tontine_contributions; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- Source: migrations/017_organization_kyb.sql
-- ============================================================================
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

-- ============================================================================
-- Source: migrations/018_organization_scanlinkpay_number.sql
-- ============================================================================
-- ============================================================================
-- 018_organization_scanlinkpay_number.sql — Unique per-organization payment
-- identifier ("ScanLinkPay number").
--
-- payment_requests today are always scoped to ONE invoice (a merchant issues
-- a request with a fixed amount, then the client pays it — see
-- payment-requests.service.ts createPaymentRequest()). There's no persistent,
-- non-expiring identifier a client can scan/type to pay a business directly,
-- the way wallet_number works for topping up a person's wallet. This adds
-- that: same sequence + trigger recipe as generate_wallet_number()
-- (006_wallets.sql), format SLP-000123. scanlinkpay_qr_url is left NULL here
-- and filled lazily by the backend on first read (see
-- OrganizationsService.getOrganizationByOwner()) rather than generated here,
-- to avoid this migration needing network/Storage access.
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS scanlinkpay_number VARCHAR(20) UNIQUE,
  ADD COLUMN IF NOT EXISTS scanlinkpay_qr_url TEXT;

CREATE SEQUENCE IF NOT EXISTS org_scanlinkpay_number_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_scanlinkpay_number()
RETURNS VARCHAR AS $$
DECLARE
  v_seq BIGINT;
BEGIN
  v_seq := nextval('org_scanlinkpay_number_seq');
  RETURN 'SLP-' || lpad(v_seq::text, 6, '0');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.set_scanlinkpay_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.scanlinkpay_number IS NULL THEN
    NEW.scanlinkpay_number := public.generate_scanlinkpay_number();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_scanlinkpay_number ON organizations;
CREATE TRIGGER trg_set_scanlinkpay_number
  BEFORE INSERT ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_scanlinkpay_number();

-- Backfill: every organization created before this migration (including
-- test accounts from earlier this session) gets a number too.
UPDATE organizations
SET scanlinkpay_number = public.generate_scanlinkpay_number()
WHERE scanlinkpay_number IS NULL;

-- ============================================================================
-- Source: migrations/019_organization_expenses.sql
-- ============================================================================
-- ============================================================================
-- 019_organization_expenses.sql — Manual expense tracking for the
-- enterprise dashboard's "Montant réel encaissé" reconciliation tile
-- (electronic revenue + cash revenue − expenses).
--
-- No POS/caisse module exists yet to record expenses automatically, so this
-- is deliberately just a flat manual-entry table — enough for an owner to
-- log "I spent X on Y" from the dashboard. Expect this to be superseded or
-- extended once the Caisse tranche lands.
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

CREATE TABLE IF NOT EXISTS organization_expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency VARCHAR(10) DEFAULT 'CDF',
  description TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organization_expenses_org_id ON organization_expenses(organization_id);

ALTER TABLE organization_expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_expenses_select_own ON organization_expenses;
CREATE POLICY organization_expenses_select_own ON organization_expenses FOR SELECT USING (
  auth.uid() IN (SELECT owner_id FROM organizations WHERE id = organization_expenses.organization_id)
  OR public.is_admin()
);

-- ============================================================================
-- Source: migrations/020_tontine_settings.sql
-- ============================================================================
-- ============================================================================
-- 020_tontine_settings.sql — Group-level settings for tontines: configurable
-- reminder timing, an optional late-payment penalty (accrues after the
-- existing grace period), and an optional auto-payment schedule that still
-- requires each member's own individual opt-in (tontine_members.auto_payment_opt_in)
-- before their wallet can ever be debited without a manual "Cotiser" tap.
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

ALTER TABLE tontine_groups
  ADD COLUMN IF NOT EXISTS reminder_days_before INT NOT NULL DEFAULT 2
    CHECK (reminder_days_before BETWEEN 1 AND 14),
  ADD COLUMN IF NOT EXISTS late_penalty_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS late_penalty_percent_per_day NUMERIC(5,2)
    CHECK (late_penalty_percent_per_day IS NULL OR (late_penalty_percent_per_day >= 0 AND late_penalty_percent_per_day <= 100)),
  ADD COLUMN IF NOT EXISTS auto_payment_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_payment_days_before INT
    CHECK (auto_payment_days_before IS NULL OR auto_payment_days_before IN (0, 2, 4));

ALTER TABLE tontine_groups
  ADD CONSTRAINT tontine_groups_penalty_percent_required
    CHECK (NOT late_penalty_enabled OR late_penalty_percent_per_day IS NOT NULL);

ALTER TABLE tontine_groups
  ADD CONSTRAINT tontine_groups_auto_payment_days_required
    CHECK (NOT auto_payment_enabled OR auto_payment_days_before IS NOT NULL);

ALTER TABLE tontine_members
  ADD COLUMN IF NOT EXISTS auto_payment_opt_in BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================================
-- Source: migrations/021_tontine_custom_frequency.sql
-- ============================================================================
-- ============================================================================
-- 021_tontine_custom_frequency.sql — Adds a "custom" frequency option
-- (every N days) alongside the existing weekly/monthly, for groups that
-- meet on their own rhythm (e.g. every 3 days) rather than a calendar week
-- or month. custom_interval_days is only required/used when
-- tontine_groups.frequency = 'custom'.
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

ALTER TABLE tontine_groups
  ADD COLUMN IF NOT EXISTS custom_interval_days INT
    CHECK (custom_interval_days IS NULL OR custom_interval_days BETWEEN 1 AND 90);

ALTER TABLE tontine_groups
  ADD CONSTRAINT tontine_groups_custom_interval_required
    CHECK (frequency <> 'custom' OR custom_interval_days IS NOT NULL);

-- ============================================================================
-- Source: migrations/022_savings_pots.sql
-- ============================================================================
-- ============================================================================
-- 022_savings_pots.sql — Round-up savings ("épargne par arrondi"), for both
-- client and merchant wallets. Opt-in, disabled by default. When enabled,
-- a payment/transfer is rounded up to the user's chosen increment (CDF
-- only — USD amounts are never rounded) and the difference moves into a
-- personal pot, separate from the spendable balance but freely withdrawable
-- at any time.
--
-- Deliberately NOT a second row in `wallets` — every existing flow
-- (login, payments, transfers) assumes exactly one wallet per user via
-- `.single()` queries; adding a second one would break all of them. Instead
-- this is its own small, ledger-style system: no stored balance anywhere
-- (same philosophy as wallets themselves), reusing the existing
-- credit_wallet/debit_wallet primitives for the real money movement against
-- the main wallet, with the 'ADJUSTMENT' entry type (already in
-- ledger_entry_type — no new enum value needed).
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

CREATE TABLE IF NOT EXISTS savings_pots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  round_up_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  round_up_increment_cents BIGINT NOT NULL DEFAULT 50000, -- 500 CDF
  goal_name TEXT,
  goal_amount_cents BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS savings_pot_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pot_id UUID NOT NULL REFERENCES savings_pots(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('round_up', 'withdrawal')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  related_reference TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_savings_pot_entries_pot ON savings_pot_entries(pot_id);

ALTER TABLE savings_pots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS savings_pots_select_own ON savings_pots;
CREATE POLICY savings_pots_select_own ON savings_pots FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

ALTER TABLE savings_pot_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS savings_pot_entries_select_own ON savings_pot_entries;
CREATE POLICY savings_pot_entries_select_own ON savings_pot_entries FOR SELECT USING (
  pot_id IN (SELECT id FROM savings_pots WHERE user_id = auth.uid())
  OR public.is_admin()
);

-- ----------------------------------------------------------------------------
-- round_up_to_savings — debits the main wallet (via debit_wallet, which
-- raises if the balance can't cover even this small extra amount — the
-- caller in application code catches that and just skips the round-up for
-- this payment, never blocking the payment itself) and records the pot
-- entry, atomically in one transaction.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.round_up_to_savings(
  p_wallet_id UUID,
  p_user_id UUID,
  p_amount_cents BIGINT,
  p_reference VARCHAR
) RETURNS BIGINT
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pot_id UUID;
  v_balance BIGINT;
BEGIN
  SELECT id INTO v_pot_id FROM savings_pots WHERE user_id = p_user_id AND round_up_enabled = TRUE;
  IF v_pot_id IS NULL THEN
    RAISE EXCEPTION 'No active savings pot for user %', p_user_id;
  END IF;

  PERFORM public.debit_wallet(p_wallet_id, p_amount_cents, 'ADJUSTMENT'::ledger_entry_type, p_reference, 'CDF', jsonb_build_object('pot_id', v_pot_id, 'type', 'roundup_out'));

  INSERT INTO savings_pot_entries (pot_id, type, amount_cents, related_reference)
  VALUES (v_pot_id, 'round_up', p_amount_cents, p_reference);

  SELECT COALESCE(SUM(CASE WHEN type = 'round_up' THEN amount_cents ELSE -amount_cents END), 0)
    INTO v_balance
    FROM savings_pot_entries WHERE pot_id = v_pot_id;

  RETURN v_balance;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- withdraw_from_savings_pot — the reverse: checks the pot's own (ledger-
-- derived) balance, records the withdrawal, then credits the main wallet.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.withdraw_from_savings_pot(
  p_wallet_id UUID,
  p_user_id UUID,
  p_amount_cents BIGINT
) RETURNS BIGINT
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pot_id UUID;
  v_balance BIGINT;
BEGIN
  IF p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'amount_cents must be positive';
  END IF;

  SELECT id INTO v_pot_id FROM savings_pots WHERE user_id = p_user_id FOR UPDATE;
  IF v_pot_id IS NULL THEN
    RAISE EXCEPTION 'No savings pot for user %', p_user_id;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN type = 'round_up' THEN amount_cents ELSE -amount_cents END), 0)
    INTO v_balance
    FROM savings_pot_entries WHERE pot_id = v_pot_id;

  IF v_balance < p_amount_cents THEN
    RAISE EXCEPTION 'Insufficient pot balance: has %, needs %', v_balance, p_amount_cents;
  END IF;

  INSERT INTO savings_pot_entries (pot_id, type, amount_cents) VALUES (v_pot_id, 'withdrawal', p_amount_cents);

  PERFORM public.credit_wallet(p_wallet_id, p_amount_cents, 'ADJUSTMENT'::ledger_entry_type, 'savings-withdrawal', 'CDF', jsonb_build_object('pot_id', v_pot_id, 'type', 'roundup_in'));

  RETURN v_balance - p_amount_cents;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.round_up_to_savings(UUID, UUID, BIGINT, VARCHAR) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.withdraw_from_savings_pot(UUID, UUID, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.round_up_to_savings(UUID, UUID, BIGINT, VARCHAR) TO service_role;
GRANT EXECUTE ON FUNCTION public.withdraw_from_savings_pot(UUID, UUID, BIGINT) TO service_role;

-- ============================================================================
-- Source: migrations/023_savings_multi_currency.sql
-- ============================================================================
-- ============================================================================
-- 023_savings_multi_currency.sql — Round-up savings becomes multi-currency:
-- one savings_pots row per (user, currency) instead of per user, each with
-- its own round_up_enabled/increment/goal — same "CDF and USD are fully
-- independent, never auto-converted" principle already used everywhere else
-- (see 008_multi_currency.sql). savings_pot_entries needs no change: each
-- pot row is now currency-specific, so its entries already are too.
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

ALTER TABLE savings_pots ADD COLUMN IF NOT EXISTS currency VARCHAR(10) NOT NULL DEFAULT 'CDF' CHECK (currency IN ('CDF', 'USD'));
-- Rows created before this migration were necessarily CDF (the only option
-- at the time) — the DEFAULT above backfills them correctly.

ALTER TABLE savings_pots DROP CONSTRAINT IF EXISTS savings_pots_user_id_key;
ALTER TABLE savings_pots ADD CONSTRAINT savings_pots_user_currency_unique UNIQUE (user_id, currency);

-- ----------------------------------------------------------------------------
-- round_up_to_savings / withdraw_from_savings_pot — signatures change (new
-- p_currency param), so the old versions must be dropped first: CREATE OR
-- REPLACE does not replace a function when the argument list changes, it
-- creates an ambiguous second overload instead (same pattern already
-- followed in 008_multi_currency.sql).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.round_up_to_savings(UUID, UUID, BIGINT, VARCHAR);
DROP FUNCTION IF EXISTS public.withdraw_from_savings_pot(UUID, UUID, BIGINT);

CREATE OR REPLACE FUNCTION public.round_up_to_savings(
  p_wallet_id UUID,
  p_user_id UUID,
  p_currency VARCHAR,
  p_amount_cents BIGINT,
  p_reference VARCHAR
) RETURNS BIGINT
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pot_id UUID;
  v_balance BIGINT;
BEGIN
  SELECT id INTO v_pot_id FROM savings_pots WHERE user_id = p_user_id AND currency = p_currency AND round_up_enabled = TRUE;
  IF v_pot_id IS NULL THEN
    RAISE EXCEPTION 'No active % savings pot for user %', p_currency, p_user_id;
  END IF;

  PERFORM public.debit_wallet(p_wallet_id, p_amount_cents, 'ADJUSTMENT'::ledger_entry_type, p_reference, p_currency, jsonb_build_object('pot_id', v_pot_id, 'type', 'roundup_out'));

  INSERT INTO savings_pot_entries (pot_id, type, amount_cents, related_reference)
  VALUES (v_pot_id, 'round_up', p_amount_cents, p_reference);

  SELECT COALESCE(SUM(CASE WHEN type = 'round_up' THEN amount_cents ELSE -amount_cents END), 0)
    INTO v_balance
    FROM savings_pot_entries WHERE pot_id = v_pot_id;

  RETURN v_balance;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.withdraw_from_savings_pot(
  p_wallet_id UUID,
  p_user_id UUID,
  p_currency VARCHAR,
  p_amount_cents BIGINT
) RETURNS BIGINT
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pot_id UUID;
  v_balance BIGINT;
BEGIN
  IF p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'amount_cents must be positive';
  END IF;

  SELECT id INTO v_pot_id FROM savings_pots WHERE user_id = p_user_id AND currency = p_currency FOR UPDATE;
  IF v_pot_id IS NULL THEN
    RAISE EXCEPTION 'No % savings pot for user %', p_currency, p_user_id;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN type = 'round_up' THEN amount_cents ELSE -amount_cents END), 0)
    INTO v_balance
    FROM savings_pot_entries WHERE pot_id = v_pot_id;

  IF v_balance < p_amount_cents THEN
    RAISE EXCEPTION 'Insufficient pot balance: has %, needs %', v_balance, p_amount_cents;
  END IF;

  INSERT INTO savings_pot_entries (pot_id, type, amount_cents) VALUES (v_pot_id, 'withdrawal', p_amount_cents);

  PERFORM public.credit_wallet(p_wallet_id, p_amount_cents, 'ADJUSTMENT'::ledger_entry_type, 'savings-withdrawal', p_currency, jsonb_build_object('pot_id', v_pot_id, 'type', 'roundup_in'));

  RETURN v_balance - p_amount_cents;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.round_up_to_savings(UUID, UUID, VARCHAR, BIGINT, VARCHAR) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.withdraw_from_savings_pot(UUID, UUID, VARCHAR, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.round_up_to_savings(UUID, UUID, VARCHAR, BIGINT, VARCHAR) TO service_role;
GRANT EXECUTE ON FUNCTION public.withdraw_from_savings_pot(UUID, UUID, VARCHAR, BIGINT) TO service_role;
