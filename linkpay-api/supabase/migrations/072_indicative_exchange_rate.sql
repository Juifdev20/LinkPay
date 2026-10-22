-- ============================================================================
-- 072_indicative_exchange_rate.sql — An indicative CDF/USD rate, set by the super admin.
--
-- Shown only as a hint under an amount ("≈ 5,12 $US" on the send screen). It NEVER converts money: CDF and USD
-- stay two independent balances, every amount is debited and credited in its own currency.
-- NULL = not set: the app shows no conversion.
--
-- Run in the Supabase SQL editor (LinkPay Test first, then production), after 071.
-- ============================================================================

ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS cdf_per_usd NUMERIC(12, 2)
  CHECK (cdf_per_usd IS NULL OR (cdf_per_usd > 0 AND cdf_per_usd < 1000000));
