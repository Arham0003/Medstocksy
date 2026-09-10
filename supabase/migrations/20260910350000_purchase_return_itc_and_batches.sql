-- ============================================================
-- B3 — Purchase return: ITC reversal + batch ledger
-- Plan: Lean Compliance Plan, Phase B / B3
--
-- Two deviations from the plan's draft, both deliberate:
--
-- 1. SIGN. The plan writes
--        UPDATE stock_batches SET qty_available = qty_available + p_quantity
--    A purchase return sends goods BACK to the supplier, so stock must go
--    DOWN, not up. The existing create_purchase_return already does
--    "products SET quantity = quantity - p_quantity". The batch ledger is
--    decremented here to match.
--
-- 2. DROP before CREATE. CREATE OR REPLACE cannot add a parameter; it would
--    register a second overload and PostgREST would then fail to resolve the
--    RPC. The old signatures are dropped first.
-- ============================================================

DROP FUNCTION IF EXISTS public.create_purchase_return(
  UUID, UUID, UUID, INTEGER, NUMERIC, NUMERIC, TEXT, DATE, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION public.create_purchase_return(
  p_account_id           UUID,
  p_supplier_id          UUID,
  p_product_id           UUID,
  p_quantity             INTEGER,
  p_purchase_price       NUMERIC,
  p_return_amount        NUMERIC,
  p_reason               TEXT,
  p_return_date          DATE,
  p_batch_number         TEXT,
  p_original_invoice_no  TEXT    DEFAULT NULL,
  p_gst_rate             NUMERIC DEFAULT 0
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id          UUID;
  v_stock       NUMERIC;
  v_gst_amount  NUMERIC;
  v_cgst        NUMERIC := 0;
  v_sgst        NUMERIC := 0;
  v_igst        NUMERIC := 0;
  v_interstate  BOOLEAN := false;
BEGIN
  -- Lock product row & validate stock
  SELECT quantity INTO v_stock
    FROM products
    WHERE id = p_product_id AND account_id = p_account_id
    FOR UPDATE;

  IF v_stock IS NULL THEN
    RAISE EXCEPTION 'Product not found' USING ERRCODE = '22023';
  END IF;
  IF v_stock < p_quantity THEN
    RAISE EXCEPTION 'Insufficient stock: % available, % requested', v_stock, p_quantity USING ERRCODE = '23514';
  END IF;

  -- ---- ITC reversal (plan item 6) --------------------------------------
  -- return_amount is the GST-inclusive credit note value, so the tax is
  -- backed out of it rather than added on top.
  SELECT COALESCE(a.is_interstate_billing, false) INTO v_interstate
    FROM accounts a WHERE a.id = p_account_id;

  v_gst_amount := ROUND(
    COALESCE(p_return_amount, 0) * COALESCE(p_gst_rate, 0)
    / NULLIF(100 + COALESCE(p_gst_rate, 0), 0), 2
  );

  IF v_interstate THEN
    v_igst := v_gst_amount;
  ELSE
    v_cgst := ROUND(v_gst_amount / 2, 2);
    v_sgst := v_gst_amount - v_cgst;   -- absorbs the odd paise
  END IF;

  INSERT INTO purchase_returns (
    account_id, supplier_id, product_id, quantity, purchase_price, return_amount,
    reason, return_date, batch_number, original_invoice_no, created_by,
    gst_rate, gst_amount, cgst_amount, sgst_amount, igst_amount
  ) VALUES (
    p_account_id, p_supplier_id, p_product_id, p_quantity, p_purchase_price, p_return_amount,
    p_reason, p_return_date, p_batch_number, p_original_invoice_no, auth.uid(),
    COALESCE(p_gst_rate, 0), v_gst_amount, v_cgst, v_sgst, v_igst
  ) RETURNING id INTO v_id;

  UPDATE products
    SET quantity = quantity - p_quantity
    WHERE id = p_product_id;

  -- Goods go back to the supplier: take them out of the batch ledger too.
  PERFORM public.adjust_batch_stock(
    p_account_id, p_product_id, p_batch_number, -p_quantity::numeric
  );

  INSERT INTO supplier_payments (account_id, supplier_id, amount, payment_type, payment_date, notes)
  VALUES (
    p_account_id, p_supplier_id, p_return_amount, 'credit_note', p_return_date,
    'Auto: Purchase Return ' || v_id::text
  );

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_purchase_return(
  UUID, UUID, UUID, INTEGER, NUMERIC, NUMERIC, TEXT, DATE, TEXT, TEXT, NUMERIC
) TO authenticated;

-- ============================================================
-- Keep EDIT and VOID in step with both the ITC figures and the batch ledger.
-- Signatures are unchanged, so plain CREATE OR REPLACE is safe here.
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_purchase_return(
  p_id                   UUID,
  p_quantity             INTEGER,
  p_purchase_price       NUMERIC,
  p_return_amount        NUMERIC,
  p_reason               TEXT,
  p_return_date          DATE,
  p_original_invoice_no  TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old         purchase_returns%ROWTYPE;
  v_diff        INTEGER;
  v_stock       NUMERIC;
  v_gst_amount  NUMERIC;
  v_cgst        NUMERIC := 0;
  v_sgst        NUMERIC := 0;
  v_igst        NUMERIC := 0;
  v_interstate  BOOLEAN := false;
BEGIN
  SELECT * INTO v_old FROM purchase_returns WHERE id = p_id FOR UPDATE;

  IF v_old.id IS NULL THEN
    RAISE EXCEPTION 'Return not found' USING ERRCODE = '22023';
  END IF;
  IF v_old.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot edit a voided return' USING ERRCODE = '22023';
  END IF;

  v_diff := p_quantity - v_old.quantity;  -- positive => deduct more from stock

  IF v_diff > 0 THEN
    SELECT quantity INTO v_stock FROM products WHERE id = v_old.product_id FOR UPDATE;
    IF v_stock < v_diff THEN
      RAISE EXCEPTION 'Insufficient stock: cannot increase by %', v_diff USING ERRCODE = '23514';
    END IF;
    UPDATE products SET quantity = quantity - v_diff WHERE id = v_old.product_id;
  ELSIF v_diff < 0 THEN
    UPDATE products SET quantity = quantity + (-v_diff) WHERE id = v_old.product_id;
  END IF;

  IF v_diff <> 0 THEN
    PERFORM public.adjust_batch_stock(
      v_old.account_id, v_old.product_id, v_old.batch_number, (-v_diff)::numeric
    );
  END IF;

  -- Recompute ITC reversal on the new credit note value, at the stored rate.
  SELECT COALESCE(a.is_interstate_billing, false) INTO v_interstate
    FROM accounts a WHERE a.id = v_old.account_id;

  v_gst_amount := ROUND(
    COALESCE(p_return_amount, 0) * COALESCE(v_old.gst_rate, 0)
    / NULLIF(100 + COALESCE(v_old.gst_rate, 0), 0), 2
  );

  IF v_interstate THEN
    v_igst := v_gst_amount;
  ELSE
    v_cgst := ROUND(v_gst_amount / 2, 2);
    v_sgst := v_gst_amount - v_cgst;
  END IF;

  UPDATE purchase_returns SET
    quantity            = p_quantity,
    purchase_price      = p_purchase_price,
    return_amount       = p_return_amount,
    reason              = p_reason,
    return_date         = p_return_date,
    original_invoice_no = p_original_invoice_no,
    gst_amount          = v_gst_amount,
    cgst_amount         = v_cgst,
    sgst_amount         = v_sgst,
    igst_amount         = v_igst,
    updated_by          = auth.uid()
  WHERE id = p_id;

  UPDATE supplier_payments
    SET amount = p_return_amount, payment_date = p_return_date
    WHERE notes = 'Auto: Purchase Return ' || p_id::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_purchase_return(
  p_id           UUID,
  p_void_reason  TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old purchase_returns%ROWTYPE;
BEGIN
  SELECT * INTO v_old FROM purchase_returns WHERE id = p_id FOR UPDATE;

  IF v_old.id IS NULL THEN
    RAISE EXCEPTION 'Return not found' USING ERRCODE = '22023';
  END IF;
  IF v_old.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Already voided' USING ERRCODE = '22023';
  END IF;

  UPDATE products
    SET quantity = quantity + v_old.quantity
    WHERE id = v_old.product_id;

  -- The goods never left: put them back on the batch they came off.
  PERFORM public.adjust_batch_stock(
    v_old.account_id, v_old.product_id, v_old.batch_number, v_old.quantity::numeric
  );

  UPDATE purchase_returns SET
    voided_at   = NOW(),
    voided_by   = auth.uid(),
    void_reason = p_void_reason
  WHERE id = p_id;

  DELETE FROM supplier_payments
    WHERE notes = 'Auto: Purchase Return ' || p_id::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_purchase_return TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_purchase_return  TO authenticated;
