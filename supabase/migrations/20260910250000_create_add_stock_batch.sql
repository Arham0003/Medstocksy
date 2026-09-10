-- ============================================================
-- B1 (adapted) — add_stock_batch()
-- Plan: Lean Compliance Plan, Phase B / B1
--
-- The plan patches a record_purchase() RPC. This codebase has no purchase
-- invoice tables and no such RPC: stock is taken in by creating or editing a
-- products row. So the same logic lives here instead, as the one entry point
-- every inward-stock path calls.
--
-- Responsibilities:
--   * compute effective_cost, handling free goods and trade discount (plan item 4)
--   * create the batch, or top up an identical batch with a weighted-average cost
--   * keep products.quantity (the aggregate the rest of the app reads) in step
-- ============================================================

CREATE OR REPLACE FUNCTION public.add_stock_batch(
  p_product_id        uuid,
  p_batch_number      text,
  p_expiry_date       date,
  p_qty               numeric,
  p_free_qty          numeric DEFAULT 0,
  p_invoice_rate      numeric DEFAULT 0,
  p_disc_pct          numeric DEFAULT 0,
  p_mrp               numeric DEFAULT NULL,
  p_hsn_code          text    DEFAULT NULL,
  p_gst_rate          numeric DEFAULT NULL,
  p_mfg_date          date    DEFAULT NULL,
  p_manufacturer      text    DEFAULT NULL,
  p_supplier_id       uuid    DEFAULT NULL,
  p_invoice_no        text    DEFAULT NULL,
  p_source            text    DEFAULT 'purchase',
  p_sync_product_qty  boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id      uuid := public.get_user_account_id();
  v_product         products%ROWTYPE;
  v_qty             numeric := COALESCE(p_qty, 0);
  v_free            numeric := COALESCE(p_free_qty, 0);
  v_units           numeric;
  v_effective_cost  numeric;
  v_hsn             text;
  v_gst_rate        numeric;
  v_mrp             numeric;
  v_batch_number    text;
  v_batch_id        uuid;
BEGIN
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No account for current user' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_product
    FROM products
    WHERE id = p_product_id AND account_id = v_account_id
    FOR UPDATE;

  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Product not found' USING ERRCODE = '22023';
  END IF;

  v_units := v_qty + v_free;
  IF v_units <= 0 THEN
    RAISE EXCEPTION 'Batch must receive at least one unit' USING ERRCODE = '23514';
  END IF;

  IF p_expiry_date IS NULL THEN
    RAISE EXCEPTION 'Expiry date is required for a stock batch' USING ERRCODE = '23502';
  END IF;

  v_batch_number := COALESCE(NULLIF(TRIM(p_batch_number), ''), 'NA');

  -- ---- Effective cost (plan item 4) ------------------------------------
  -- Trade discount reduces the money paid; free goods increase the units
  -- received. Both must land in the per-unit cost or COGS is overstated.
  --   10 units @ 100 with 1 free  ->  1000 / 11  =  90.9091
  v_effective_cost := (v_qty * COALESCE(p_invoice_rate, 0)
                       * (1 - COALESCE(p_disc_pct, 0) / 100.0))
                      / NULLIF(v_units, 0);

  -- ---- Resolve HSN / GST rate / MRP ------------------------------------
  v_hsn := COALESCE(NULLIF(TRIM(p_hsn_code), ''), v_product.hsn_code);

  v_gst_rate := p_gst_rate;
  IF v_gst_rate IS NULL AND v_hsn IS NOT NULL THEN
    SELECT h.gst_rate INTO v_gst_rate
      FROM hsn_codes h
      WHERE h.account_id = v_account_id AND h.hsn = v_hsn;
  END IF;
  IF v_gst_rate IS NULL THEN
    SELECT COALESCE(v_product.gst, s.default_gst_rate, 12) INTO v_gst_rate
      FROM settings s WHERE s.account_id = v_account_id;
  END IF;
  v_gst_rate := COALESCE(v_gst_rate, v_product.gst, 12);

  v_mrp := COALESCE(p_mrp, v_product.selling_price, 0);

  -- ---- Insert, or top up an identical batch ----------------------------
  INSERT INTO stock_batches (
    account_id, product_id,
    batch_number, expiry_date, mfg_date, manufacturer,
    qty_purchased, qty_free, qty_available,
    invoice_rate, trade_discount_pct, effective_cost,
    mrp, hsn_code, gst_rate,
    supplier_id, invoice_no, source
  ) VALUES (
    v_account_id, p_product_id,
    v_batch_number, p_expiry_date, p_mfg_date,
    COALESCE(p_manufacturer, v_product.manufacturer),
    v_qty, v_free, v_units,
    COALESCE(p_invoice_rate, 0), COALESCE(p_disc_pct, 0), v_effective_cost,
    v_mrp, v_hsn, v_gst_rate,
    COALESCE(p_supplier_id, v_product.supplier_id), p_invoice_no, p_source
  )
  ON CONFLICT ON CONSTRAINT stock_batches_identity_uniq DO UPDATE SET
    -- Weighted-average cost across everything ever received on this batch.
    effective_cost = (
      stock_batches.effective_cost * (stock_batches.qty_purchased + stock_batches.qty_free)
      + EXCLUDED.effective_cost * (EXCLUDED.qty_purchased + EXCLUDED.qty_free)
    ) / NULLIF(
      stock_batches.qty_purchased + stock_batches.qty_free
      + EXCLUDED.qty_purchased + EXCLUDED.qty_free, 0
    ),
    qty_purchased = stock_batches.qty_purchased + EXCLUDED.qty_purchased,
    qty_free      = stock_batches.qty_free      + EXCLUDED.qty_free,
    qty_available = stock_batches.qty_available + EXCLUDED.qty_available,
    invoice_rate  = EXCLUDED.invoice_rate,
    mrp           = EXCLUDED.mrp,
    hsn_code      = COALESCE(EXCLUDED.hsn_code, stock_batches.hsn_code),
    gst_rate      = EXCLUDED.gst_rate,
    invoice_no    = COALESCE(EXCLUDED.invoice_no, stock_batches.invoice_no),
    supplier_id   = COALESCE(EXCLUDED.supplier_id, stock_batches.supplier_id)
  RETURNING id INTO v_batch_id;

  -- ---- Keep the aggregate in step --------------------------------------
  IF p_sync_product_qty THEN
    UPDATE products SET
      quantity       = quantity + v_units,
      -- Landed cost, not invoice rate: this is what margin reports should use.
      purchase_price = ROUND(v_effective_cost, 2),
      -- Only fill batch identity if the product has none yet; never clobber.
      batch_number   = COALESCE(NULLIF(TRIM(batch_number), ''), v_batch_number),
      expiry_date    = COALESCE(expiry_date, p_expiry_date::timestamptz),
      hsn_code       = COALESCE(hsn_code, v_hsn),
      gst            = COALESCE(gst, v_gst_rate),
      updated_at     = now()
    WHERE id = p_product_id;
  END IF;

  RETURN v_batch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_stock_batch(
  uuid, text, date, numeric, numeric, numeric, numeric, numeric,
  text, numeric, date, text, uuid, text, text, boolean
) TO authenticated;

COMMENT ON FUNCTION public.add_stock_batch IS
  'Single entry point for inward stock. Computes effective_cost (free goods + trade discount aware), creates or tops up the batch, and syncs products.quantity.';
