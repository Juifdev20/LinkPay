-- ============================================================================
-- 070_expense_pro_payment_method.sql — The Pro subscription is paid by Mobile Money (FlexPaie).
--
-- expense_pro_payments.payment_method used the value 'cinetpay' for "paid through the payment provider", a
-- provider ScanLinkPay does not use. It becomes 'mobile_money' (psp_provider still says which provider).
--
-- Run once in the Supabase SQL editor (after 069), BEFORE deploying the API version that writes 'mobile_money'.
-- ============================================================================

DO $$
DECLARE
  c TEXT;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
     WHERE con.conrelid = 'public.expense_pro_payments'::regclass AND con.contype = 'c' AND att.attname = 'payment_method'
  LOOP
    EXECUTE format('ALTER TABLE public.expense_pro_payments DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

UPDATE expense_pro_payments SET payment_method = 'mobile_money' WHERE payment_method = 'cinetpay';

ALTER TABLE expense_pro_payments
  ADD CONSTRAINT expense_pro_payments_payment_method_check CHECK (payment_method IN ('wallet', 'mobile_money'));
