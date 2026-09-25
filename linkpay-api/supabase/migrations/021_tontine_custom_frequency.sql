-- ============================================================================
-- 021_tontine_custom_frequency.sql — Adds a "custom" frequency option
-- (every N days) alongside the existing weekly/monthly, for groups that
-- meet on their own rhythm (e.g. every 3 days) rather than a calendar week
-- or month. custom_interval_days is only required/used when
-- tontine_groups.frequency = 'custom'.
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

ALTER TABLE tontine_groups
  ADD COLUMN IF NOT EXISTS custom_interval_days INT
    CHECK (custom_interval_days IS NULL OR custom_interval_days BETWEEN 1 AND 90);

ALTER TABLE tontine_groups
  ADD CONSTRAINT tontine_groups_custom_interval_required
    CHECK (frequency <> 'custom' OR custom_interval_days IS NOT NULL);
