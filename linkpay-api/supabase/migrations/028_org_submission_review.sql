-- ============================================================================
-- 028_org_submission_review.sql — Super-admin validation workflow for
-- enterprise onboarding.
--
-- Until now, an organization's ScanLinkPay number was assigned the instant
-- its row was created (018_organization_scanlinkpay_number.sql, BEFORE
-- INSERT trigger) — the business was effectively "live" from registration
-- onward. The new flow requires a human review step: the owner completes
-- the KYB onboarding wizard and submits, a super admin reviews the
-- submission and clicks Valider or Rejeter, and ONLY on validation does the
-- organization become active and get its ScanLinkPay number. This adds the
-- columns that track that lifecycle and moves the number-assignment trigger
-- from INSERT time to the validation UPDATE.
-- Requires 027_org_status_rejected.sql to have already run (adds the
-- 'rejected' status value this migration's trigger condition doesn't use
-- directly, but the review UI/API built on top of this does).
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS validated_by UUID REFERENCES auth.users(id);

-- Move ScanLinkPay number assignment from row-creation time to
-- validation time. set_scanlinkpay_number() itself (defined in migration
-- 018) is unchanged — it only fills the column if still NULL, so re-firing
-- it here on the exact UPDATE that flips status to 'active' is safe and
-- idempotent.
DROP TRIGGER IF EXISTS trg_set_scanlinkpay_number ON organizations;
CREATE TRIGGER trg_set_scanlinkpay_number
  BEFORE UPDATE ON organizations
  FOR EACH ROW
  WHEN (NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active')
  EXECUTE FUNCTION public.set_scanlinkpay_number();
