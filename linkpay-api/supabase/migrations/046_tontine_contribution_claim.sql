-- ============================================================================
-- 046_tontine_contribution_claim.sql — A tontine contribution is paid once.
--
-- contribute() (the member, with their PIN) and the 9am auto-payment job both
-- checked "is it paid yet?" and then moved the money, so two overlapping
-- attempts — the job running while the member taps "Cotiser", or a double
-- tap with two different idempotency keys — each passed the check and each
-- transferred the full amount to the recipient.
--
-- claimed_at is the lock: a payment attempt first claims the contribution with
-- one atomic UPDATE (only one wins). A claim older than a couple of minutes
-- counts as abandoned (the process died mid-payment) and can be taken again,
-- so a crash never leaves a contribution stuck.
--
-- Run once in the Supabase SQL editor, before deploying the API version that
-- uses it.
-- ============================================================================

ALTER TABLE tontine_contributions ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

-- ============================================================================
-- POS: a ticket can't be paid beyond its total, even by two taps at once.
--
-- The till computed "remaining = total - payments", checked the amount against
-- it, then inserted the payment — three steps with nothing holding the ticket
-- in between. A double tap on "Encaisser" recorded the same cash payment
-- twice: the ticket showed overpaid and the register's expected cash was
-- inflated, which then shows up as a shortage in the cashier's reconciliation.
--
-- add_pos_payment() locks the ticket row, recomputes what is still owed from
-- the payments actually stored, and only then inserts — one statement at a time
-- per ticket. Only the API may call it.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.add_pos_payment(
  p_ticket_id UUID,
  p_method TEXT,
  p_amount_cents BIGINT,
  p_received_cents BIGINT,
  p_status TEXT,
  p_payment_request_id UUID,
  p_created_by UUID
) RETURNS pos_ticket_payments
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket pos_tickets;
  v_paid BIGINT;
  v_payment pos_ticket_payments;
BEGIN
  SELECT * INTO v_ticket FROM pos_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POS_TICKET_NOT_FOUND';
  END IF;
  IF v_ticket.status <> 'open' THEN
    RAISE EXCEPTION 'POS_TICKET_NOT_OPEN';
  END IF;

  SELECT COALESCE(SUM(amount_cents), 0) INTO v_paid FROM pos_ticket_payments WHERE ticket_id = p_ticket_id;

  IF p_amount_cents <= 0 OR p_amount_cents > v_ticket.total_cents - v_paid THEN
    RAISE EXCEPTION 'POS_PAYMENT_EXCEEDS_REMAINING:%', GREATEST(v_ticket.total_cents - v_paid, 0);
  END IF;

  INSERT INTO pos_ticket_payments (ticket_id, method, amount_cents, received_cents, status, payment_request_id, created_by)
  VALUES (p_ticket_id, p_method, p_amount_cents, p_received_cents, p_status, p_payment_request_id, p_created_by)
  RETURNING * INTO v_payment;

  RETURN v_payment;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.add_pos_payment(UUID, TEXT, BIGINT, BIGINT, TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_pos_payment(UUID, TEXT, BIGINT, BIGINT, TEXT, UUID, UUID) TO service_role;

-- ============================================================================
-- Stock can't go below zero, even with two sales at once.
--
-- createMovement() read the quantity, checked "enough left?", then inserted the
-- movement (a trigger applies it to stock_items.quantity): two simultaneous
-- sales of the last unit both passed the check and the stock went to -1.
-- With the constraint the second movement is rejected by the database itself.
-- NOT VALID: it applies to every new/updated row without failing on rows that
-- may already be negative; fix those, then VALIDATE CONSTRAINT.
-- ============================================================================
ALTER TABLE stock_items DROP CONSTRAINT IF EXISTS stock_items_quantity_nonnegative;
ALTER TABLE stock_items ADD CONSTRAINT stock_items_quantity_nonnegative CHECK (quantity >= 0) NOT VALID;
