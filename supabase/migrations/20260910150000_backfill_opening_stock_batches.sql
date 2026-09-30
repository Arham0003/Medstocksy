-- ============================================================
-- Migration 2b - Freeze existing stock as an "Opening Stock" batch
-- Plan Q1, option A (fresh start).
--
-- Every product currently holding stock gets exactly ONE batch row carrying
-- its whole quantity, using whatever batch_number / expiry / purchase_price
-- the product already has. All subsequent inward stock creates real batches
-- through add_stock_batch().
--
-- Runs once. Re-running is a no-op: the unique identity constraint plus the
-- NOT EXISTS guard stop it from double-counting.
-- ============================================================

DO $$
DECLARE
  -- Assumed shelf life for legacy stock with no recorded expiry date.
  -- One year sorts opening stock AHEAD of freshly purchased goods (typically
  -- 2-3 years out), so old stock moves first under FEFO, while still clearing
  -- the "never sell expired" guard in deduct_fefo().
  k_assumed_shelf_life interval := interval '1 year';
BEGIN
  INSERT INTO public.stock_batches (
    account_id, product_id,
    batch_number, expiry_date, manufacturer,
    qty_purchased, qty_free, qty_available,
    invoice_rate, trade_discount_pct, effective_cost,
    mrp, hsn_code, gst_rate,
    supplier_id, source
  )
  SELECT
    p.account_id,
    p.id,
    COALESCE(NULLIF(TRIM(p.batch_number), ''), 'OPENING'),
    COALESCE(p.expiry_date::date, (CURRENT_DATE + k_assumed_shelf_life)::date),
    p.manufacturer,
    p.quantity,
    0,
    p.quantity,
    COALESCE(p.purchase_price, 0),
    0,
    COALESCE(p.purchase_price, 0),   -- no free goods on opening stock, so cost = rate
    p.selling_price,
    p.hsn_code,
    COALESCE(p.gst, s.default_gst_rate, 12),
    p.supplier_id,
    'opening'
  FROM public.products p
  LEFT JOIN public.settings s ON s.account_id = p.account_id
  WHERE p.quantity > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.stock_batches b WHERE b.product_id = p.id
    )
  ON CONFLICT ON CONSTRAINT stock_batches_identity_uniq DO NOTHING;

  RAISE NOTICE 'Opening stock backfill complete.';
END $$;

-- Sanity check after running (should return 0 rows):
--   SELECT p.id, p.name, p.quantity, COALESCE(SUM(b.qty_available), 0) AS batched
--   FROM products p LEFT JOIN stock_batches b ON b.product_id = p.id
--   GROUP BY p.id, p.name, p.quantity
--   HAVING p.quantity <> COALESCE(SUM(b.qty_available), 0);
