-- ============================================================================
-- Merchants no longer require admin approval
-- ============================================================================
-- Only organizations (enterprise accounts) go through an approval gate.
-- A merchant is now live as soon as it's created, same as a plain client
-- account — see linkpay-api/src/auth/auth.service.ts and
-- linkpay-api/src/merchants/merchants.service.ts (both now insert with
-- status: 'active' instead of 'pending').
-- ============================================================================

ALTER TABLE merchants ALTER COLUMN status SET DEFAULT 'active';

-- Bring merchants created before this change in line with the new rule —
-- they were never actually blocked by 'pending' (no route checked it), this
-- just makes the stored status match reality going forward.
UPDATE merchants SET status = 'active' WHERE status = 'pending';
