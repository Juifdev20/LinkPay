-- 075 — The "Ventes" module of businesses (shops, electronics…) keeps working without network.
--
-- Same rules as the till (074): a sale made offline is paid in cash on the spot, kept on the device and sent later
-- in one piece. record_offline_org_sale() writes the sale (PAID, cash), its lines with the product sheet frozen at
-- sale time, and the stock exit in ONE transaction, once per client_ref (unique per business). The money wins:
-- a price changed meanwhile or a stock already sold elsewhere is reported (offline_conflicts), never refused; the
-- stock exit stops at zero. Restock requests written offline also carry a client_ref, kept once. Re-runnable.

ALTER TABLE restock_requests ADD COLUMN IF NOT EXISTS client_ref UUID;
CREATE UNIQUE INDEX IF NOT EXISTS restock_requests_merchant_client_ref
  ON restock_requests (merchant_id, client_ref) WHERE client_ref IS NOT NULL;

-- Cash put in / taken out of the till drawer offline (petty expense, deposit): kept once too.
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS client_ref UUID;
CREATE UNIQUE INDEX IF NOT EXISTS cash_movements_session_client_ref
  ON cash_movements (session_id, client_ref) WHERE client_ref IS NOT NULL;

ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_ref UUID;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS recorded_offline BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS offline_conflicts JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS sales_org_client_ref
  ON sales (organization_id, client_ref) WHERE client_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION public.record_offline_org_sale(
  p_org_id UUID,
  p_merchant_id UUID,
  p_seller_id UUID,
  p_client_ref UUID,
  p_sold_at TIMESTAMPTZ,
  p_items JSONB          -- [{ "stock_item_id": uuid, "quantity": int, "unit_price_cents": int }]
) RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing sales;
  v_sale_id UUID;
  v_reference TEXT;
  v_line JSONB;
  v_item stock_items;
  v_qty INT;
  v_price BIGINT;
  v_take INT;
  v_total BIGINT := 0;
  v_currency TEXT := NULL;
  v_conflicts JSONB := '[]'::jsonb;
  v_sold_at TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_existing FROM sales WHERE organization_id = p_org_id AND client_ref = p_client_ref;
  IF FOUND THEN
    RETURN jsonb_build_object('sale_id', v_existing.id, 'created', false, 'conflicts', COALESCE(v_existing.offline_conflicts, '[]'::jsonb));
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'SALE_OFFLINE_EMPTY'; END IF;
  PERFORM 1 FROM merchants WHERE id = p_merchant_id AND organization_id = p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SALE_OFFLINE_BAD_STATION'; END IF;

  v_sold_at := LEAST(GREATEST(COALESCE(p_sold_at, NOW()), NOW() - INTERVAL '7 days'), NOW());
  -- Readable and unique: SALE-HL-<16 hex of the device id> (64 random bits).
  v_reference := 'SALE-HL-' || UPPER(SUBSTRING(REPLACE(p_client_ref::text, '-', '') FROM 1 FOR 16));

  INSERT INTO sales (organization_id, merchant_id, reference, status, payment_method, currency, total_cents,
                     created_by, paid_at, created_at, updated_at, client_ref, recorded_offline)
  VALUES (p_org_id, p_merchant_id, v_reference, 'PAID', 'cash', 'CDF', 0, p_seller_id, v_sold_at, v_sold_at, NOW(),
          p_client_ref, TRUE)
  RETURNING id INTO v_sale_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_line->>'quantity')::INT;
    v_price := (v_line->>'unit_price_cents')::BIGINT;
    IF v_qty IS NULL OR v_qty <= 0 OR v_price IS NULL OR v_price < 0 THEN RAISE EXCEPTION 'SALE_OFFLINE_BAD_LINE'; END IF;

    SELECT * INTO v_item FROM stock_items
      WHERE id = (v_line->>'stock_item_id')::UUID AND merchant_id = p_merchant_id
      FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'SALE_OFFLINE_ITEM_NOT_FOUND:%', v_line->>'stock_item_id'; END IF;
    IF v_currency IS NOT NULL AND v_currency <> v_item.currency THEN RAISE EXCEPTION 'SALE_OFFLINE_MIXED_CURRENCY'; END IF;
    v_currency := v_item.currency;

    INSERT INTO sale_items (sale_id, stock_item_id, name, category, quantity, unit_price_cents, unit_cost_cents, currency, details, created_at)
    VALUES (v_sale_id, v_item.id, v_item.name, v_item.category, v_qty, v_price, COALESCE(v_item.cost_price_cents, 0), v_item.currency,
            jsonb_build_object('brand', v_item.brand, 'model', v_item.model, 'condition', v_item.condition,
                               'serial_number', v_item.serial_number, 'warranty_months', v_item.warranty_months,
                               'attributes', COALESCE(v_item.attributes, '{}'::jsonb)),
            v_sold_at);
    v_total := v_total + v_price * v_qty;

    IF v_price <> v_item.unit_price_cents THEN
      v_conflicts := v_conflicts || jsonb_build_object('type', 'price_changed', 'stock_item_id', v_item.id, 'name', v_item.name,
                                                       'sold_cents', v_price, 'current_cents', v_item.unit_price_cents);
    END IF;

    v_take := LEAST(v_qty, GREATEST(v_item.quantity, 0));
    IF v_take > 0 THEN
      INSERT INTO stock_movements (stock_item_id, merchant_id, type, quantity_delta, reason, created_by, created_at)
      VALUES (v_item.id, p_merchant_id, 'out', -v_take, 'Vente hors ligne ' || v_reference, p_seller_id, v_sold_at);
    END IF;
    IF v_take < v_qty THEN
      v_conflicts := v_conflicts || jsonb_build_object('type', 'stock_short', 'stock_item_id', v_item.id, 'name', v_item.name,
                                                       'sold', v_qty, 'deducted', v_take);
    END IF;
  END LOOP;

  UPDATE sales
    SET currency = COALESCE(v_currency, 'CDF'), total_cents = v_total,
        offline_conflicts = CASE WHEN jsonb_array_length(v_conflicts) > 0 THEN v_conflicts ELSE NULL END
    WHERE id = v_sale_id;

  RETURN jsonb_build_object('sale_id', v_sale_id, 'created', true, 'conflicts', v_conflicts, 'reference', v_reference);
EXCEPTION
  WHEN unique_violation THEN
    SELECT * INTO v_existing FROM sales WHERE organization_id = p_org_id AND client_ref = p_client_ref;
    IF FOUND THEN
      RETURN jsonb_build_object('sale_id', v_existing.id, 'created', false, 'conflicts', COALESCE(v_existing.offline_conflicts, '[]'::jsonb));
    END IF;
    RAISE;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.record_offline_org_sale(UUID, UUID, UUID, UUID, TIMESTAMPTZ, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_offline_org_sale(UUID, UUID, UUID, UUID, TIMESTAMPTZ, JSONB) TO service_role;
