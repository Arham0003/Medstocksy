-- ============================================================
-- B4 - Sales return routing by return_type
-- Plan: Lean Compliance Plan, Phase B / B4
--
-- A salable return rejoins sellable stock. An expired or damaged return must
-- NOT: it is a write-off. Today a return is a raw negative-quantity INSERT
-- into sales, and the update_product_stock trigger unconditionally adds the
-- quantity back to products.quantity. That trigger is patched here too --
-- the plan omits this because its codebase keeps stock only in
-- stock_batches, whereas this one also keeps products.quantity.
--
-- Deviation from the plan's draft: p_product_id is dropped from the
-- signature and read off the sale instead, so a return can never be booked
-- against a different product than the one sold.
-- ============================================================

-- Link a return row back to the line it reverses, so over-returning can be
-- rejected server-side instead of only in the UI.
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS returned_from_sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS return_reason text;

CREATE INDEX IF NOT EXISTS idx_sales_returned_from ON public.sales(returned_from_sale_id);

COMMENT ON COLUMN public.sales.returned_from_sale_id IS 'On a return row: the original sale line being reversed.';

-- ------------------------------------------------------------
-- 1) Stock trigger: honour return_type
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_product_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  effective_units NUMERIC;
BEGIN
  -- Expired / damaged goods do not go back on the shelf. The negative sales
  -- row still books the refund and the GST reversal; the stock is written off.
  IF NEW.return_type IN ('expired', 'damaged') THEN
    RETURN NEW;
  END IF;

  IF NEW.sub_qty IS NOT NULL AND NEW.sub_qty != 0
     AND NEW.pcs_per_unit IS NOT NULL AND NEW.pcs_per_unit > 0 THEN
    effective_units := NEW.quantity + (NEW.sub_qty::NUMERIC / NEW.pcs_per_unit::NUMERIC);
  ELSE
    effective_units := NEW.quantity;
  END IF;

  UPDATE public.products
    SET quantity   = quantity - effective_units,
        updated_at = NOW()
    WHERE id = NEW.product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found with id: %', NEW.product_id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.update_product_stock() IS
  'Maintains products.quantity on sale/return. Sales reduce stock, salable returns restore it, expired/damaged returns are written off (stock untouched).';

-- ------------------------------------------------------------
-- 2) record_sales_return()
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_sales_return(
  p_sale_id     uuid,
  p_quantity    numeric,
  p_return_type text DEFAULT 'salable',
  p_reason      text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale          sales%ROWTYPE;
  v_account_id    uuid := public.get_user_account_id();
  v_already       numeric;
  v_effective_qty numeric;
  v_ratio         numeric;
  v_total         numeric;
  v_gst           numeric;
  v_taxable       numeric;
  v_cgst          numeric := 0;
  v_sgst          numeric := 0;
  v_igst          numeric := 0;
  v_interstate    boolean := false;
  v_batch_number  text;
  v_return_id     uuid;
BEGIN
  IF p_return_type NOT IN ('salable', 'expired', 'damaged') THEN
    RAISE EXCEPTION 'Invalid return type: %', p_return_type USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF v_sale.id IS NULL THEN
    RAISE EXCEPTION 'Sale not found' USING ERRCODE = '22023';
  END IF;
  IF v_sale.account_id IS DISTINCT FROM v_account_id THEN
    RAISE EXCEPTION 'Sale belongs to another account' USING ERRCODE = '42501';
  END IF;
  IF v_sale.quantity <= 0 THEN
    RAISE EXCEPTION 'Cannot return a return' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_quantity, 0) <= 0 THEN
    RAISE EXCEPTION 'Return quantity must be positive' USING ERRCODE = '23514';
  END IF;

  -- Reject over-returning against this line.
  SELECT COALESCE(SUM(-s.quantity), 0) INTO v_already
    FROM sales s WHERE s.returned_from_sale_id = p_sale_id;

  IF v_already + p_quantity > v_sale.quantity THEN
    RAISE EXCEPTION 'Only % unit(s) left to return on this line', v_sale.quantity - v_already
      USING ERRCODE = '23514';
  END IF;

  -- Proportional refund. Sub-quantity (loose tablets) makes the sold amount
  -- fractional, so the ratio is taken against effective units, matching how
  -- the UI has always computed it.
  IF v_sale.sub_qty IS NOT NULL AND v_sale.sub_qty <> 0
     AND v_sale.pcs_per_unit IS NOT NULL AND v_sale.pcs_per_unit > 0 THEN
    v_effective_qty := v_sale.quantity + (v_sale.sub_qty::numeric / v_sale.pcs_per_unit::numeric);
  ELSE
    v_effective_qty := v_sale.quantity;
  END IF;

  v_ratio   := p_quantity / NULLIF(v_effective_qty, 0);
  v_total   := ROUND(COALESCE(v_sale.total_price, 0) * v_ratio, 2);
  v_gst     := ROUND(COALESCE(v_sale.gst_amount, 0)  * v_ratio, 2);
  v_taxable := ROUND(
    COALESCE(
      v_sale.taxable_value,
      COALESCE(v_sale.total_price, 0) - COALESCE(v_sale.gst_amount, 0)
    ) * v_ratio, 2);

  SELECT COALESCE(a.is_interstate_billing, false) INTO v_interstate
    FROM accounts a WHERE a.id = v_account_id;

  IF v_interstate THEN
    v_igst := v_gst;
  ELSE
    v_cgst := ROUND(v_gst / 2, 2);
    v_sgst := v_gst - v_cgst;
  END IF;

  -- Negative reversal row. Every money column is negated; the trigger above
  -- decides whether products.quantity moves.
  INSERT INTO sales (
    account_id, product_id, user_id,
    quantity, unit_price, total_price, gst_amount,
    taxable_value, gst_rate, cgst_amount, sgst_amount, igst_amount,
    hsn_code, batch_id, cogs_rate,
    bill_id, customer_name, customer_phone,
    return_type, returned_from_sale_id, return_reason
  ) VALUES (
    v_sale.account_id, v_sale.product_id, COALESCE(v_sale.user_id, auth.uid()),
    -p_quantity, v_sale.unit_price, -v_total, -v_gst,
    -v_taxable, v_sale.gst_rate, -v_cgst, -v_sgst, -v_igst,
    v_sale.hsn_code, v_sale.batch_id, v_sale.cogs_rate,
    v_sale.bill_id, v_sale.customer_name, v_sale.customer_phone,
    p_return_type, p_sale_id, p_reason
  ) RETURNING id INTO v_return_id;

  -- Batch ledger: only salable goods rejoin the FEFO queue.
  IF p_return_type = 'salable' THEN
    IF v_sale.batch_id IS NOT NULL THEN
      UPDATE stock_batches
        SET qty_available = qty_available + p_quantity
        WHERE id = v_sale.batch_id;
    ELSE
      -- Pre-batch sale: fall back to the product's nearest-expiry batch.
      SELECT b.batch_number INTO v_batch_number
        FROM stock_batches b
        WHERE b.account_id = v_account_id AND b.product_id = v_sale.product_id
        ORDER BY b.expiry_date ASC LIMIT 1;

      PERFORM public.adjust_batch_stock(
        v_account_id, v_sale.product_id, v_batch_number, p_quantity
      );
    END IF;
  END IF;
  -- expired / damaged: stock stays out of both products.quantity and
  -- stock_batches. The write-off is implicit -- there is no expense ledger
  -- in this build (double-entry is deliberately out of scope).

  RETURN v_return_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_sales_return(uuid, numeric, text, text) TO authenticated;

COMMENT ON FUNCTION public.record_sales_return IS
  'Books a customer return as a negative sales row. Salable returns restock; expired/damaged are written off. Rejects over-returning a line.';
