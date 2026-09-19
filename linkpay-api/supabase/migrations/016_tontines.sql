-- ============================================================================
-- 016_tontines.sql — Digital tontine/likelemba: rotating savings groups.
--
-- No group wallet holds money. Each cycle's contribution is a direct
-- wallet-to-wallet transfer (see wallets.service.ts transfer()) from a
-- member straight to that cycle's recipient — this table set only tracks
-- who owes what to whom and by when; the money movement itself reuses the
-- existing transfers table/RPC untouched. Run once in the Supabase SQL
-- editor, same as previous migrations.
-- ============================================================================

CREATE TABLE IF NOT EXISTS tontine_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  creator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contribution_amount_cents BIGINT NOT NULL CHECK (contribution_amount_cents > 0),
  currency VARCHAR(10) NOT NULL DEFAULT 'CDF',
  frequency VARCHAR(20) NOT NULL DEFAULT 'monthly', -- 'weekly' | 'monthly'
  max_members INT NOT NULL CHECK (max_members BETWEEN 3 AND 30),
  grace_period_days INT NOT NULL DEFAULT 3,
  status VARCHAR(20) NOT NULL DEFAULT 'forming', -- forming | active | completed | cancelled
  current_cycle INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tontine_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID NOT NULL REFERENCES tontine_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  join_order INT NOT NULL,
  payout_position INT, -- set by the random draw; NULL until the group is full
  status VARCHAR(20) NOT NULL DEFAULT 'invited', -- invited | active | declined | left
  invited_at TIMESTAMPTZ DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  UNIQUE (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS tontine_cycles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID NOT NULL REFERENCES tontine_groups(id) ON DELETE CASCADE,
  cycle_number INT NOT NULL,
  recipient_member_id UUID NOT NULL REFERENCES tontine_members(id),
  due_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- active | completed
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (group_id, cycle_number)
);

-- One row per non-recipient member per cycle — the ower.
CREATE TABLE IF NOT EXISTS tontine_contributions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cycle_id UUID NOT NULL REFERENCES tontine_cycles(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES tontine_groups(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES tontine_members(id),
  amount_cents BIGINT NOT NULL,
  currency VARCHAR(10) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | paid | overdue
  transfer_id UUID REFERENCES transfers(id),
  due_date DATE NOT NULL,
  paid_at TIMESTAMPTZ,
  reminder_sent_at TIMESTAMPTZ,
  overdue_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (cycle_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_tontine_members_group ON tontine_members(group_id);
CREATE INDEX IF NOT EXISTS idx_tontine_members_user ON tontine_members(user_id);
CREATE INDEX IF NOT EXISTS idx_tontine_contributions_status_due ON tontine_contributions(status, due_date);
CREATE INDEX IF NOT EXISTS idx_tontine_contributions_member ON tontine_contributions(member_id);
CREATE INDEX IF NOT EXISTS idx_tontine_cycles_group ON tontine_cycles(group_id);

-- ----------------------------------------------------------------------------
-- RLS — safety net only; the NestJS backend always uses the service-role
-- key (bypasses RLS) via SupabaseService, same as every other table here.
-- ----------------------------------------------------------------------------
ALTER TABLE tontine_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE tontine_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE tontine_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tontine_contributions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_tontine_member(group_uuid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS(
    SELECT 1 FROM tontine_members WHERE group_id = group_uuid AND user_id = auth.uid()
  )
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

DROP POLICY IF EXISTS tontine_groups_select_member ON tontine_groups;
CREATE POLICY tontine_groups_select_member ON tontine_groups FOR SELECT USING (
  auth.uid() = creator_id OR public.is_tontine_member(id) OR public.is_admin()
);

DROP POLICY IF EXISTS tontine_members_select_member ON tontine_members;
CREATE POLICY tontine_members_select_member ON tontine_members FOR SELECT USING (
  public.is_tontine_member(group_id) OR public.is_admin()
);

DROP POLICY IF EXISTS tontine_cycles_select_member ON tontine_cycles;
CREATE POLICY tontine_cycles_select_member ON tontine_cycles FOR SELECT USING (
  public.is_tontine_member(group_id) OR public.is_admin()
);

DROP POLICY IF EXISTS tontine_contributions_select_member ON tontine_contributions;
CREATE POLICY tontine_contributions_select_member ON tontine_contributions FOR SELECT USING (
  public.is_tontine_member(group_id) OR public.is_admin()
);

-- Live "who has paid this cycle" updates on the frontend.
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE tontine_groups; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE tontine_members; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE tontine_cycles; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE tontine_contributions; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
