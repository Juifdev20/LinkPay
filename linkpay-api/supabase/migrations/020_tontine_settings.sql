-- ============================================================================
-- 020_tontine_settings.sql — Group-level settings for tontines: configurable
-- reminder timing, an optional late-payment penalty (accrues after the
-- existing grace period), and an optional auto-payment schedule that still
-- requires each member's own individual opt-in (tontine_members.auto_payment_opt_in)
-- before their wallet can ever be debited without a manual "Cotiser" tap.
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

ALTER TABLE tontine_groups
  ADD COLUMN IF NOT EXISTS reminder_days_before INT NOT NULL DEFAULT 2
    CHECK (reminder_days_before BETWEEN 1 AND 14),
  ADD COLUMN IF NOT EXISTS late_penalty_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS late_penalty_percent_per_day NUMERIC(5,2)
    CHECK (late_penalty_percent_per_day IS NULL OR (late_penalty_percent_per_day >= 0 AND late_penalty_percent_per_day <= 100)),
  ADD COLUMN IF NOT EXISTS auto_payment_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_payment_days_before INT
    CHECK (auto_payment_days_before IS NULL OR auto_payment_days_before IN (0, 2, 4));

ALTER TABLE tontine_groups
  ADD CONSTRAINT tontine_groups_penalty_percent_required
    CHECK (NOT late_penalty_enabled OR late_penalty_percent_per_day IS NOT NULL);

ALTER TABLE tontine_groups
  ADD CONSTRAINT tontine_groups_auto_payment_days_required
    CHECK (NOT auto_payment_enabled OR auto_payment_days_before IS NOT NULL);

ALTER TABLE tontine_members
  ADD COLUMN IF NOT EXISTS auto_payment_opt_in BOOLEAN NOT NULL DEFAULT FALSE;
