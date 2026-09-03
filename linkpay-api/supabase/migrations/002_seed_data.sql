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
