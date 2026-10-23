-- 074 — The till and the stock keep working without network.
--
-- A sale made offline is paid in cash on the spot (the customer leaves with the goods), kept on the device, and sent
-- later in one piece: record_offline_pos_sale() writes the ticket, its lines, the cash payment and the stock
-- deduction in ONE transaction. Rules:
--   * once: the device's id (client_ref) is unique per shop — the same sale sent twice returns the first;
--   * the money wins: the sale is always recorded at the price the customer paid. What the device could not know is
--     reported, never refused: a price changed meanwhile, a stock already sold by another till (the deduction stops
--     at zero and the missing units are listed for the inventory), a cash session already closed;
--   * the sale keeps its real time (sold_at), within the last 7 days, never in the future.
-- Stock movements made offline (reception, exit, adjustment) also carry a client_ref, kept once.
-- Re-runnable.

ALTER TABLE pos_tickets ADD COLUMN IF NOT EXISTS client_ref UUID;
ALTER TABLE pos_tickets ADD COLUMN IF NOT EXISTS recorded_offline BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE pos_tickets ADD COLUMN IF NOT EXISTS offline_conflicts JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS pos_tickets_merchant_client_ref
  ON pos_tickets (merchant_id, client_ref) WHERE client_ref IS NOT NULL;

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS client_ref UUID;
CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_merchant_client_ref
  ON stock_movements (merchant_id, client_ref) WHERE client_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION public.record_offline_pos_sale(
  p_merchant_id UUID,
  p_cashier_id UUID,
  p_client_ref UUID,
  p_currency TEXT,
  p_sold_at TIMESTAMPTZ,
  p_items JSONB,          -- [{ "stock_item_id": uuid, "quantity": int, "unit_price_cents": int }]
  p_received_cents BIGINT
) RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing pos_tickets;
  v_session cash_register_sessions;
  v_ticket_id UUID;
  v_number BIGINT;
  v_rate NUMERIC;
  v_line JSONB;
  v_item stock_items;
  v_qty INT;
  v_price BIGINT;
  v_take INT;
  v_total BIGINT := 0;
  v_tva BIGINT;
  v_conflicts JSONB := '[]'::jsonb;
  v_sold_at TIMESTAMPTZ;
BEGIN
  -- Already received (answer lost, sent again): give back the first one.
  SELECT * INTO v_existing FROM pos_tickets WHERE merchant_id = p_merchant_id AND client_ref = p_client_ref;
  IF FOUND THEN
    RETURN jsonb_build_object('ticket_id', v_existing.id, 'created', false, 'conflicts', COALESCE(v_existing.offline_conflicts, '[]'::jsonb));
  END IF;

  IF p_currency NOT IN ('CDF', 'USD') THEN RAISE EXCEPTION 'POS_OFFLINE_BAD_CURRENCY'; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'POS_OFFLINE_EMPTY'; END IF;

  v_sold_at := LEAST(GREATEST(COALESCE(p_sold_at, NOW()), NOW() - INTERVAL '7 days'), NOW());

  -- The session that was open when the sale was made; if it was closed since, the last one of that currency.
  SELECT * INTO v_session FROM cash_register_sessions
    WHERE merchant_id = p_merchant_id AND currency = p_currency AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1;
  IF NOT FOUND THEN
    SELECT * INTO v_session FROM cash_register_sessions
      WHERE merchant_id = p_merchant_id AND currency = p_currency AND opened_at <= v_sold_at
      ORDER BY opened_at DESC LIMIT 1;
    IF NOT FOUND THEN
      SELECT * INTO v_session FROM cash_register_sessions
        WHERE merchant_id = p_merchant_id AND currency = p_currency
        ORDER BY opened_at DESC LIMIT 1;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'POS_OFFLINE_NO_SESSION'; END IF;
    v_conflicts := v_conflicts || jsonb_build_object('type', 'session_closed', 'session_id', v_session.id);
  END IF;

  SELECT COALESCE(pos_tva_rate_pct, 0) INTO v_rate FROM merchants WHERE id = p_merchant_id;
  v_number := public.next_pos_ticket_number(p_merchant_id);

  INSERT INTO pos_tickets (merchant_id, cashier_user_id, cash_register_session_id, status, currency, ticket_number,
                           client_ref, recorded_offline, created_at, updated_at)
  VALUES (p_merchant_id, p_cashier_id, v_session.id, 'open', p_currency, v_number, p_client_ref, TRUE, v_sold_at, NOW())
  RETURNING id INTO v_ticket_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_line->>'quantity')::INT;
    v_price := (v_line->>'unit_price_cents')::BIGINT;
    IF v_qty IS NULL OR v_qty <= 0 OR v_price IS NULL OR v_price < 0 THEN RAISE EXCEPTION 'POS_OFFLINE_BAD_LINE'; END IF;

    SELECT * INTO v_item FROM stock_items
      WHERE id = (v_line->>'stock_item_id')::UUID AND merchant_id = p_merchant_id
      FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'POS_OFFLINE_ITEM_NOT_FOUND:%', v_line->>'stock_item_id'; END IF;
    IF v_item.currency <> p_currency THEN RAISE EXCEPTION 'POS_OFFLINE_ITEM_CURRENCY:%', v_item.name; END IF;

    INSERT INTO pos_ticket_items (ticket_id, stock_item_id, product_name_snapshot, quantity, unit_price_cents_snapshot,
                                  cost_price_cents_snapshot, line_total_cents, created_at)
    VALUES (v_ticket_id, v_item.id, v_item.name, v_qty, v_price, v_item.cost_price_cents, v_price * v_qty, v_sold_at);
    v_total := v_total + v_price * v_qty;

    IF v_price <> v_item.unit_price_cents THEN
      v_conflicts := v_conflicts || jsonb_build_object('type', 'price_changed', 'stock_item_id', v_item.id, 'name', v_item.name,
                                                       'sold_cents', v_price, 'current_cents', v_item.unit_price_cents);
    END IF;

    -- The stock never goes below zero: what another till already sold is listed for the inventory.
    v_take := LEAST(v_qty, GREATEST(v_item.quantity, 0));
    IF v_take > 0 THEN
      INSERT INTO stock_movements (stock_item_id, merchant_id, type, quantity_delta, reason, created_by, created_at)
      VALUES (v_item.id, p_merchant_id, 'sale', -v_take, 'Vente hors ligne ticket #' || v_number, p_cashier_id, v_sold_at);
    END IF;
    IF v_take < v_qty THEN
      v_conflicts := v_conflicts || jsonb_build_object('type', 'stock_short', 'stock_item_id', v_item.id, 'name', v_item.name,
                                                       'sold', v_qty, 'deducted', v_take);
    END IF;
  END LOOP;

  v_tva := CASE WHEN v_rate > 0 THEN ROUND(v_total * v_rate / (100 + v_rate)) ELSE 0 END;

  UPDATE pos_tickets SET subtotal_cents = v_total - v_tva, tva_cents = v_tva, total_cents = v_total WHERE id = v_ticket_id;

  IF v_total > 0 THEN
    INSERT INTO pos_ticket_payments (ticket_id, method, amount_cents, received_cents, status, created_by, created_at)
    VALUES (v_ticket_id, 'cash', v_total, GREATEST(COALESCE(p_received_cents, v_total), v_total), 'confirmed', p_cashier_id, v_sold_at);
  END IF;

  UPDATE pos_tickets
    SET status = 'paid', payment_method = 'cash', paid_at = v_sold_at, updated_at = NOW(),
        offline_conflicts = CASE WHEN jsonb_array_length(v_conflicts) > 0 THEN v_conflicts ELSE NULL END
    WHERE id = v_ticket_id;

  RETURN jsonb_build_object('ticket_id', v_ticket_id, 'created', true, 'conflicts', v_conflicts);
EXCEPTION
  -- Two sends of the same sale crossed: the unique index kept the first one.
  WHEN unique_violation THEN
    SELECT * INTO v_existing FROM pos_tickets WHERE merchant_id = p_merchant_id AND client_ref = p_client_ref;
    IF FOUND THEN
      RETURN jsonb_build_object('ticket_id', v_existing.id, 'created', false, 'conflicts', COALESCE(v_existing.offline_conflicts, '[]'::jsonb));
    END IF;
    RAISE;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.record_offline_pos_sale(UUID, UUID, UUID, TEXT, TIMESTAMPTZ, JSONB, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_offline_pos_sale(UUID, UUID, UUID, TEXT, TIMESTAMPTZ, JSONB, BIGINT) TO service_role;
