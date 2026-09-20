-- ============================================================================
-- 016_organization_scanlinkpay_number.sql — Unique per-organization payment
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
