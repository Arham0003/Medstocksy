-- ============================================================
-- B2 — deduct_fefo()
-- Plan: Lean Compliance Plan, Phase B / B2
--
-- Consumes stock oldest-expiry-first and reports which batches were hit, at
-- what cost. Callers use the returned rows to stamp batch_id and cogs_rate
-- onto the sale line.
--
-- This function does NOT touch products.quantity. The existing
-- update_product_stock trigger on sales already maintains that aggregate;
-- doing it here as well would double-count.
--
-- Deviation from the plan's draft: the plan's query selects bare
-- effective_cost / gst_rate while OUT parameters of the same name are in
-- scope, which Postgres rejects as an ambiguous column reference. The table
-- is aliased and every column qualified below.
-- ============================================================

CREATE OR REPLACE FUNCTION public.deduct_fefo(
  p_account_id      uuid,
  p_product_id      uuid,
  p_qty_needed      numeric,
  -- Schedule M quarantine buffer. 0 = sell right up to the expiry date;
  -- 90 = refuse to sell anything expiring within the next 90 days.
  p_quarantine_days integer DEFAULT 0
)
RETURNS TABLE(
  batch_id       uuid,
  batch_number   text,
  expiry_date    date,
  qty_used       numeric,
  effective_cost numeric,
  gst_rate       numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  batch_row  record;
  remaining  numeric := COALESCE(p_qty_needed, 0);
  qty_take   numeric;
  v_cutoff   date := CURRENT_DATE + (COALESCE(p_quarantine_days, 0) || ' days')::interval;
BEGIN
  IF remaining <= 0 THEN
    RETURN;
  END IF;

  IF p_account_id IS DISTINCT FROM public.get_user_account_id() THEN
    RAISE EXCEPTION 'Account mismatch' USING ERRCODE = '42501';
  END IF;

  FOR batch_row IN
    SELECT sb.id,
           sb.batch_number   AS b_number,
           sb.expiry_date    AS b_expiry,
           sb.qty_available  AS b_available,
           sb.effective_cost AS b_cost,
           sb.gst_rate       AS b_gst
    FROM public.stock_batches sb
    WHERE sb.account_id    = p_account_id
      AND sb.product_id    = p_product_id
      AND sb.qty_available > 0
      AND sb.expiry_date  >= v_cutoff   -- never sell expired / quarantined stock
    ORDER BY sb.expiry_date ASC         -- FEFO
    FOR UPDATE
  LOOP
    EXIT WHEN remaining <= 0;

    qty_take := LEAST(remaining, batch_row.b_available);

    UPDATE public.stock_batches
      SET qty_available = qty_available - qty_take
      WHERE id = batch_row.id;

    batch_id       := batch_row.id;
    batch_number   := batch_row.b_number;
    expiry_date    := batch_row.b_expiry;
    qty_used       := qty_take;
    effective_cost := batch_row.b_cost;
    gst_rate       := batch_row.b_gst;
    RETURN NEXT;

    remaining := remaining - qty_take;
  END LOOP;

  IF remaining > 0 THEN
    RAISE EXCEPTION 'Insufficient sellable stock. Short by % units (expired or quarantined batches are excluded)', remaining
      USING ERRCODE = '23514';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.deduct_fefo(uuid, uuid, numeric, integer) TO authenticated;

COMMENT ON FUNCTION public.deduct_fefo IS
  'Deducts p_qty_needed from stock_batches oldest-expiry-first and returns the batches consumed. Raises 23514 if sellable stock is short. Does not touch products.quantity.';
