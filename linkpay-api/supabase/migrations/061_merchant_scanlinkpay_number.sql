-- ============================================================================
-- 061_merchant_scanlinkpay_number.sql — Unique per-merchant payment
-- identifier, same concept as the organization's ScanLinkPay number
-- (018_organization_scanlinkpay_number.sql).
--
-- Until now a standalone merchant (no organization) could only be paid two
-- ways: a per-invoice payment request, or a wallet transfer to their
-- SLP-MER-… wallet number — which bypasses the merchant payment path
-- entirely (no commission, not counted in the store's sales stats). This
-- gives every merchant a persistent, non-expiring number a customer can
-- scan (QR) or type to pay them through the real payment-request flow
-- (quick-pay), so a counter payment is a sale.
--
-- The number comes from the SAME sequence as organizations
-- (org_scanlinkpay_number_seq, format SLP-000123) — one global namespace
-- for "payable business" identifiers, so a number can never collide
-- between a store and a company. Unlike organizations (number assigned at
-- validation time, migration 028), merchants go live the moment they're
-- created (status 'active' on INSERT — see merchants.service.ts), so the
-- trigger fires BEFORE INSERT, the original 018 pattern.
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS scanlinkpay_number VARCHAR(20) UNIQUE,
  ADD COLUMN IF NOT EXISTS scanlinkpay_qr_url TEXT;

DROP TRIGGER IF EXISTS trg_set_scanlinkpay_number ON merchants;
CREATE TRIGGER trg_set_scanlinkpay_number
  BEFORE INSERT ON merchants
  FOR EACH ROW
  EXECUTE FUNCTION public.set_scanlinkpay_number();

-- Backfill: every merchant created before this migration gets a number too.
UPDATE merchants
SET scanlinkpay_number = public.generate_scanlinkpay_number()
WHERE scanlinkpay_number IS NULL;
