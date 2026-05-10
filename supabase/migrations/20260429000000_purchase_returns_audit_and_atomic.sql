-- ============================================================
-- Purchase Returns: audit columns, soft-delete, original invoice,
-- atomic RPCs (create / update / void) that also credit supplier.
-- ============================================================

-- 1) Audit, soft-delete, invoice columns
ALTER TABLE public.purchase_returns
  ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS created_by           UUID,
  ADD COLUMN IF NOT EXISTS updated_by           UUID,
  ADD COLUMN IF NOT EXISTS voided_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by            UUID,
  ADD COLUMN IF NOT EXISTS void_reason          TEXT,
  ADD COLUMN IF NOT EXISTS original_invoice_no  TEXT;

CREATE INDEX IF NOT EXISTS idx_pr_voided_at         ON public.purchase_returns (voided_at);
CREATE INDEX IF NOT EXISTS idx_pr_supplier_active   ON public.purchase_returns (supplier_id) WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pr_account_date      ON public.purchase_returns (account_id, return_date DESC);

-- 2) updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_purchase_returns_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_pr_updated_at ON public.purchase_returns;
CREATE TRIGGER trg_touch_pr_updated_at
  BEFORE UPDATE ON public.purchase_returns
  FOR EACH ROW EXECUTE FUNCTION public.touch_purchase_returns_updated_at();

-- 3) Allow 'credit_note' payment_type on supplier_payments (no-op if no check constraint)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_schema = 'public'
      AND table_name = 'supplier_payments'
      AND constraint_name LIKE '%payment_type%'
  ) THEN
    EXECUTE 'ALTER TABLE public.supplier_payments DROP CONSTRAINT IF EXISTS supplier_payments_payment_type_check';
  END IF;
END $$;

-- ============================================================
-- 4) Atomic CREATE
-- ============================================================
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
  p_original_invoice_no  TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id     UUID;
  v_stock  INTEGER;
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

  INSERT INTO purchase_returns (
    account_id, supplier_id, product_id, quantity, purchase_price, return_amount,
    reason, return_date, batch_number, original_invoice_no, created_by
  ) VALUES (
    p_account_id, p_supplier_id, p_product_id, p_quantity, p_purchase_price, p_return_amount,
    p_reason, p_return_date, p_batch_number, p_original_invoice_no, auth.uid()
  ) RETURNING id INTO v_id;

  UPDATE products
    SET quantity = quantity - p_quantity
    WHERE id = p_product_id;

  INSERT INTO supplier_payments (account_id, supplier_id, amount, payment_type, payment_date, notes)
  VALUES (
    p_account_id, p_supplier_id, p_return_amount, 'credit_note', p_return_date,
    'Auto: Purchase Return ' || v_id::text
  );

  RETURN v_id;
END;
$$;

-- ============================================================
-- 5) Atomic UPDATE (edit qty / price / reason / date / invoice)
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
  v_old    purchase_returns%ROWTYPE;
  v_diff   INTEGER;
  v_stock  INTEGER;
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

  UPDATE purchase_returns SET
    quantity            = p_quantity,
    purchase_price      = p_purchase_price,
    return_amount       = p_return_amount,
    reason              = p_reason,
    return_date         = p_return_date,
    original_invoice_no = p_original_invoice_no,
    updated_by          = auth.uid()
  WHERE id = p_id;

  -- Update the auto-generated supplier credit row
  UPDATE supplier_payments
    SET amount = p_return_amount, payment_date = p_return_date
    WHERE notes = 'Auto: Purchase Return ' || p_id::text;
END;
$$;

-- ============================================================
-- 6) Atomic VOID (soft-delete; restore stock; remove credit)
-- ============================================================
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

  UPDATE purchase_returns SET
    voided_at   = NOW(),
    voided_by   = auth.uid(),
    void_reason = p_void_reason
  WHERE id = p_id;

  DELETE FROM supplier_payments
    WHERE notes = 'Auto: Purchase Return ' || p_id::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_purchase_return TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_purchase_return TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_purchase_return  TO authenticated;
