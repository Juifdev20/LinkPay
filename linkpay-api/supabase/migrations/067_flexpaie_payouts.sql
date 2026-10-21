-- ============================================================================
-- 067_flexpaie_payouts.sql — Automatic withdrawals through FlexPaie (PayoutService).
--
-- FlexPaie can only be asked about a payout by ITS order number (GET …/check/<orderNumber>), and gives that number
-- only in the answer to the send request (or later in its callback). This table is the journal of each withdrawal
-- sent to FlexPaie, written BEFORE the request leaves, so that we always know which of these is true:
--
--   SENDING   the request left (or was about to) and we have no answer yet: the money MAY have left. Never resent.
--             If FlexPaie's callback brings the order number, it is checked and the row becomes ACCEPTED; with no
--             news after 30 minutes the withdrawal is refunded and the row becomes ABANDONED.
--   ACCEPTED  FlexPaie accepted it and gave its order number: the status is read with that number.
--   NOT_SENT  FlexPaie refused it up front for a passing reason (another payout in progress): sent again later.
--   ABANDONED SENDING with no news after 30 minutes: the withdrawal was refunded.
--
-- reference = the withdrawal id. One row per withdrawal: the primary key is what stops two senders (the request and
-- the reconciliation job) from sending the same withdrawal twice.
--
-- API only. Run once in the Supabase SQL editor (after 066), BEFORE deploying the API version that uses it.
-- ============================================================================

CREATE TABLE IF NOT EXISTS flexpaie_payouts (
  reference TEXT PRIMARY KEY,
  order_number TEXT UNIQUE,
  state TEXT NOT NULL DEFAULT 'SENDING' CHECK (state IN ('SENDING', 'ACCEPTED', 'NOT_SENT', 'ABANDONED')),
  attempts INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE flexpaie_payouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON flexpaie_payouts FROM PUBLIC, anon, authenticated;
GRANT ALL ON flexpaie_payouts TO service_role;
