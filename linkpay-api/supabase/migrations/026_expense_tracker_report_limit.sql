-- ============================================================================
-- 026_expense_tracker_report_limit.sql — Replaces the personal expense
-- tracker's time-based trial (025_personal_expense_tracker.sql:
-- trial_days/trial_started_at/trial_ends_at) with a count-based one: the
-- super_admin sets how many expense reports a user may CREATE-AND-CLOSE for
-- free (trial_report_limit), not how many days they get. Also drops the
-- "one report per calendar day" restriction — expense_days had
-- UNIQUE(user_id, expense_date), which blocked starting a second report the
-- same day once the first was closed. Renamed to expense_reports since
-- "day" no longer means anything once several can share a date.
--
-- expense_pro_status gains a `plan` ('trial' | 'unlimited'). Trial rows
-- track trial_report_limit (snapshotted at plan-choice time, same
-- never-retroactive rule as before) and trial_reports_used (incremented by
-- the service each time a report is closed while on the trial plan).
-- pro_expires_at (paid "unlimited" access) is untouched — still extended by
-- pay_expense_pro_via_wallet/extend_expense_pro exactly as before, just
-- setting plan = 'unlimited' alongside it now instead of touching trial
-- dates that no longer exist.
--
-- No production users yet (feature unreleased) — existing test rows are
-- migrated in place below rather than requiring a clean slate.
--
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

ALTER TABLE expense_days RENAME TO expense_reports;
ALTER TABLE expense_reports DROP CONSTRAINT IF EXISTS expense_days_user_id_expense_date_key;
ALTER TABLE expense_entries RENAME COLUMN day_id TO report_id;

DROP POLICY IF EXISTS expense_days_select_own ON expense_reports;
DROP POLICY IF EXISTS expense_reports_select_own ON expense_reports;
CREATE POLICY expense_reports_select_own ON expense_reports FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

ALTER TABLE expense_tracker_settings RENAME COLUMN trial_days TO trial_report_limit;
ALTER TABLE expense_tracker_settings ALTER COLUMN trial_report_limit SET DEFAULT 3;
-- The old value (e.g. 14) was a day count — meaningless as a report count.
UPDATE expense_tracker_settings SET trial_report_limit = 3 WHERE id = 1;

ALTER TABLE expense_pro_status ADD COLUMN IF NOT EXISTS plan VARCHAR(20) NOT NULL DEFAULT 'trial' CHECK (plan IN ('trial', 'unlimited'));
ALTER TABLE expense_pro_status ADD COLUMN IF NOT EXISTS trial_report_limit INT;
ALTER TABLE expense_pro_status ADD COLUMN IF NOT EXISTS trial_reports_used INT NOT NULL DEFAULT 0;

-- Migrate existing test rows: already-paid ones become 'unlimited' (their
-- pro_expires_at is untouched); pure trial rows restart fresh under the new
-- unit, snapshotting the current global default.
UPDATE expense_pro_status SET plan = 'unlimited' WHERE pro_expires_at IS NOT NULL AND pro_expires_at > NOW();
UPDATE expense_pro_status SET trial_report_limit = (SELECT trial_report_limit FROM expense_tracker_settings WHERE id = 1), trial_reports_used = 0
  WHERE plan = 'trial';

ALTER TABLE expense_pro_status DROP COLUMN IF EXISTS trial_started_at;
ALTER TABLE expense_pro_status DROP COLUMN IF EXISTS trial_ends_at;

-- ----------------------------------------------------------------------------
-- pay_expense_pro_via_wallet / extend_expense_pro — same parameter list and
-- return type as 025 (CREATE OR REPLACE is enough, no DROP FUNCTION needed)
-- — only the body's upsert changes, from writing trial_started_at/
-- trial_ends_at (now dropped) to writing plan = 'unlimited'.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pay_expense_pro_via_wallet(
  p_user_id UUID,
  p_wallet_id UUID,
  p_amount_cents BIGINT,
  p_currency VARCHAR,
  p_reference VARCHAR
) RETURNS TIMESTAMPTZ
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_expiry TIMESTAMPTZ;
BEGIN
  PERFORM public.debit_wallet(p_wallet_id, p_amount_cents, 'PLATFORM_FEE'::ledger_entry_type, p_reference, p_currency, jsonb_build_object('kind', 'expense_pro_subscription'));

  INSERT INTO expense_pro_status (user_id, plan, pro_expires_at)
  VALUES (p_user_id, 'unlimited', NOW() + INTERVAL '30 days')
  ON CONFLICT (user_id) DO UPDATE
    SET plan = 'unlimited',
        pro_expires_at = GREATEST(NOW(), COALESCE(expense_pro_status.pro_expires_at, NOW())) + INTERVAL '30 days',
        updated_at = NOW()
  RETURNING pro_expires_at INTO v_new_expiry;

  RETURN v_new_expiry;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.extend_expense_pro(
  p_user_id UUID
) RETURNS TIMESTAMPTZ
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_expiry TIMESTAMPTZ;
BEGIN
  INSERT INTO expense_pro_status (user_id, plan, pro_expires_at)
  VALUES (p_user_id, 'unlimited', NOW() + INTERVAL '30 days')
  ON CONFLICT (user_id) DO UPDATE
    SET plan = 'unlimited',
        pro_expires_at = GREATEST(NOW(), COALESCE(expense_pro_status.pro_expires_at, NOW())) + INTERVAL '30 days',
        updated_at = NOW()
  RETURNING pro_expires_at INTO v_new_expiry;

  RETURN v_new_expiry;
END;
$$ LANGUAGE plpgsql;
