-- ============================================================================
-- 061_withdrawal_banks.sql — Banks offered for withdrawals and settlements, chosen by the super admin.
--
-- platform_settings.withdrawal_banks: the banks (names of the catalogue in linkpay-api/src/wallets/bank-account.ts) that the
-- customers may pick for a withdrawal to a bank account or for a merchant's settlement account. NULL = none chosen yet:
-- the whole catalogue is offered, so nothing changes until the super admin makes a choice
-- (Administration → Banques de retrait). Written only by the API (service key), like the rest of the table.
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS withdrawal_banks TEXT[];
