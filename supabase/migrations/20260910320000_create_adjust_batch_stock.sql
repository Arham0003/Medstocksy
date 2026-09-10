-- ============================================================
-- adjust_batch_stock() — shared batch-ledger helper
-- Supporting function for B3 (purchase returns) and B4 (sales returns).
--
-- Deliberately forgiving: if a product has no batch rows yet (legacy stock
-- that predates the backfill, or an account mid-rollout), it adjusts nothing
-- and returns 0 rather than raising. products.quantity remains authoritative
-- in that case, so returns keep working while batches are being adopted.
-- ============================================================

CREATE OR REPLACE FUNCTION public.adjust_batch_stock(
  p_account_id   uuid,
  p_product_id   uuid,
  p_batch_number text,
  p_delta        numeric   -- positive = back into stock, negative = out of stock
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  batch_row  record;
  remaining  numeric;
  qty_take   numeric;
  v_applied  numeric := 0;
  v_batch    text := NULLIF(TRIM(p_batch_number), '');
BEGIN
  IF COALESCE(p_delta, 0) = 0 THEN
    RETURN 0;
  END IF;

  -- ---- Putting stock back ---------------------------------------------
  IF p_delta > 0 THEN
    UPDATE stock_batches sb
      SET qty_available = sb.qty_available + p_delta
      WHERE sb.id = (
        SELECT b.id FROM stock_batches b
        WHERE b.account_id = p_account_id
          AND b.product_id = p_product_id
          AND (v_batch IS NULL OR b.batch_number = v_batch)
        -- Prefer the batch actually named; otherwise the nearest expiry, so
        -- restored stock rejoins the FEFO queue where it left off.
        ORDER BY (b.batch_number = v_batch) DESC NULLS LAST, b.expiry_date ASC
        LIMIT 1
      );
    IF FOUND THEN
      v_applied := p_delta;
    END IF;
    RETURN v_applied;
  END IF;

  -- ---- Taking stock out ------------------------------------------------
  remaining := -p_delta;

  FOR batch_row IN
    SELECT b.id, b.qty_available
    FROM stock_batches b
    WHERE b.account_id    = p_account_id
      AND b.product_id    = p_product_id
      AND b.qty_available > 0
      AND (v_batch IS NULL OR b.batch_number = v_batch)
    ORDER BY b.expiry_date ASC   -- nearest expiry leaves first
    FOR UPDATE
  LOOP
    EXIT WHEN remaining <= 0;
    qty_take  := LEAST(remaining, batch_row.qty_available);

    UPDATE stock_batches
      SET qty_available = qty_available - qty_take
      WHERE id = batch_row.id;

    remaining := remaining - qty_take;
    v_applied := v_applied + qty_take;
  END LOOP;

  -- A shortfall means the batch ledger is behind products.quantity (legacy
  -- stock). products.quantity has already been validated by the caller, so
  -- this is reported, not fatal.
  IF remaining > 0 THEN
    RAISE NOTICE 'adjust_batch_stock: % units not covered by any batch for product %', remaining, p_product_id;
  END IF;

  RETURN -v_applied;
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_batch_stock(uuid, uuid, text, numeric) TO authenticated;

COMMENT ON FUNCTION public.adjust_batch_stock IS
  'Adds or removes units from stock_batches for one product, preferring the named batch and otherwise nearest expiry. No-op when the product has no batches.';
