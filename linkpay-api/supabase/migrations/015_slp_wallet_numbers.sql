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
