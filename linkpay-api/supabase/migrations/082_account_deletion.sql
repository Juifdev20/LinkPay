-- ============================================================================
-- 082_account_deletion.sql — A person deletes their own account (Google Play requirement).
--
-- From the website (Paramètres → « Supprimer mon compte » opens it): the person says why they leave, confirms with
-- their password, and the account is closed at once. Who may: a client, a merchant (their shop closes with it), the
-- owner of an enterprise (the enterprise closes with it). Not the employees (vendeur/caissier, gérant, magasinier…):
-- their account belongs to the business, the owner removes them. Not the administrators.
--
-- Money first: refused while anything is left on the balance, in the savings, in a withdrawal on its way or in a
-- tontine — the person withdraws it first. Nothing is ever taken or set to zero by the deletion.
--
-- What is erased: name, phone, email, photo, codes (PIN, access code, recovery), devices, notifications to the phone.
-- What is kept, without the name: the money movements (ledger, transfers, withdrawals, sales), which the law requires
-- to keep. The login is blocked for good; the phone number and email can open a new account later.
--
-- Run in the Supabase SQL editor (LinkPay Test first, then production), after 081.
-- ============================================================================

-- Why people leave (no name, no phone: only what helps improve the app).
CREATE TABLE IF NOT EXISTS account_deletions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,          -- no foreign key: kept as an anonymous number
  role TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('not_used', 'technical', 'fees', 'privacy', 'other_account', 'other')),
  comment TEXT CHECK (comment IS NULL OR length(comment) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_account_deletions_created ON account_deletions(created_at DESC);

ALTER TABLE account_deletions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS account_deletions_admin_read ON account_deletions;
CREATE POLICY account_deletions_admin_read ON account_deletions FOR SELECT USING (public.is_admin());

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
