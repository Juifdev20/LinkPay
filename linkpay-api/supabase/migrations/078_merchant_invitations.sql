-- 078 — A cashier joins a shop only if they accept.
--
-- A shop owner used to add a cashier by email and the person's account became a cashier at once, without being asked
-- or told. With the phone number as well (much easier to know than an email), anybody could have turned someone's
-- account into their cashier. Now the owner sends an INVITATION (by phone or email); the person sees it in their app
-- and accepts or refuses; nothing changes on their account until they accept. The owner can cancel it while it waits.
-- An invitation not answered within 7 days lapses. Re-runnable.

CREATE TABLE IF NOT EXISTS merchant_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One invitation waiting per shop and person.
CREATE UNIQUE INDEX IF NOT EXISTS merchant_invitations_one_pending
  ON merchant_invitations (merchant_id, user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS merchant_invitations_user ON merchant_invitations (user_id, status);

-- Only the API (service role) reads and writes it.
ALTER TABLE merchant_invitations ENABLE ROW LEVEL SECURITY;
