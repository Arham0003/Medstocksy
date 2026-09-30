-- Wholesale statutory compliance: Drugs & Cosmetics Rule 65 and CGST Rule 46.
--
-- Everything here is additive. No existing column changes type, no existing row
-- is rewritten, and every new column is nullable or defaulted, so retail rows
-- and retail queries are untouched by construction.
--
-- What this adds:
--   1. Buyer drug licence, expiry, state code and ship-to on `sales` (Rule 65)
--   2. Free-goods marker on `sales` (scheme rows were indistinguishable from
--      a genuine zero-value sale)
--   3. Seller FSSAI, DL form type and DL validity on `accounts`, set once in
--      Settings rather than re-typed per bill
--   4. Schedule H/H1/X and storage condition on `products`
--   5. Supplier drug licence, guarded because `suppliers` was created outside
--      the migration history and may not exist on a rebuilt database
--   6. `invoice_sequences` plus `next_invoice_number()` for the sequential
--      financial-year series CGST Rule 46 requires
--   7. `record_sales_return` patched so a wholesale credit note is filed as
--      wholesale, and so the tax reversal mirrors the original split instead of
--      being recomputed from the account-wide interstate flag

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 + 2. sales
-- ---------------------------------------------------------------------------
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS wholesale_customer_dl        TEXT,
  ADD COLUMN IF NOT EXISTS wholesale_customer_dl_expiry DATE,
  ADD COLUMN IF NOT EXISTS buyer_state_code             TEXT,
  ADD COLUMN IF NOT EXISTS ship_to_address              TEXT,
  ADD COLUMN IF NOT EXISTS bill_serial                  TEXT,
  ADD COLUMN IF NOT EXISTS is_free                      BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.sales.wholesale_customer_dl IS
  'Buyer drug licence number, Rule 65(4). Snapshot of what was printed, so a later edit to the party never rewrites history.';
COMMENT ON COLUMN public.sales.wholesale_customer_dl_expiry IS
  'Buyer drug licence validity. Proves the sale was lawful on the day it was made.';
COMMENT ON COLUMN public.sales.buyer_state_code IS
  'Two-digit GST state code of the buyer, taken from the GSTIN prefix. Place of supply, and the input to the IGST decision.';
COMMENT ON COLUMN public.sales.bill_serial IS
  'Human-readable sequential invoice number, e.g. WS/26-27/00001. bill_id stays the UUID key; this is for display and filing.';
COMMENT ON COLUMN public.sales.is_free IS
  'TRUE for scheme give-away rows. They deduct stock like any other line but carry no revenue.';

-- ---------------------------------------------------------------------------
-- 3. accounts: seller-side compliance, configured once in Settings
-- ---------------------------------------------------------------------------
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS fssai_number        TEXT,
  ADD COLUMN IF NOT EXISTS dl_form_type        TEXT,
  ADD COLUMN IF NOT EXISTS drug_license_expiry DATE;

COMMENT ON COLUMN public.accounts.fssai_number IS
  'Seller FSSAI licence. Printed on wholesale invoices when set; required where nutraceuticals are supplied.';
COMMENT ON COLUMN public.accounts.dl_form_type IS
  'Drug licence form: 20, 20B, 21, 21B or 20G. Printed beside the licence number on the wholesale invoice.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_dl_form_type_chk'
  ) THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT accounts_dl_form_type_chk
      CHECK (dl_form_type IS NULL OR dl_form_type IN ('20', '20B', '21', '21B', '20G'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. products: controlled drugs and cold chain
-- ---------------------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS schedule_type     TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS storage_condition TEXT NOT NULL DEFAULT 'ambient';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_schedule_type_chk'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_schedule_type_chk
      CHECK (schedule_type IN ('general', 'H', 'H1', 'X'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_storage_condition_chk'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_storage_condition_chk
      CHECK (storage_condition IN ('ambient', 'refrigerated', 'frozen'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. suppliers: drug licence
--
-- `suppliers` is not created by any migration in this repository; it exists in
-- the live database and in the generated types only. An unguarded ALTER would
-- succeed in production and fail on any environment rebuilt from migrations,
-- so the change is applied only when the table is actually present.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.suppliers') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS drug_license TEXT';
  ELSE
    RAISE NOTICE 'suppliers table absent; skipping drug_license. Re-run once the table exists.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Sequential invoice numbering, CGST Rule 46
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_sequences (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  series      TEXT NOT NULL DEFAULT 'WS',
  fy          TEXT NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT invoice_sequences_uniq UNIQUE (account_id, series, fy)
);

ALTER TABLE public.invoice_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_manages_sequences" ON public.invoice_sequences;
CREATE POLICY "owner_manages_sequences" ON public.invoice_sequences
  FOR ALL TO authenticated
  USING (account_id = public.get_user_account_id())
  WITH CHECK (account_id = public.get_user_account_id());

COMMENT ON TABLE public.invoice_sequences IS
  'One counter per account, series and financial year. Gaps are acceptable and expected; duplicates are not.';

-- Indian financial year label for a date: 1 April to 31 March, so 2026-09-25
-- falls in 2026-27 and is labelled 26-27.
CREATE OR REPLACE FUNCTION public.financial_year_label(p_on date DEFAULT CURRENT_DATE)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
           WHEN EXTRACT(MONTH FROM p_on) >= 4
             THEN to_char(p_on, 'YY') || '-' || to_char(p_on + INTERVAL '1 year', 'YY')
           ELSE to_char(p_on - INTERVAL '1 year', 'YY') || '-' || to_char(p_on, 'YY')
         END;
$$;

-- Allocates the next number in the caller's own series.
--
-- The account is taken from get_user_account_id() rather than an argument, so a
-- caller cannot draw a number from someone else's series. The upsert locks the
-- counter row, which is what makes two tills allocating at the same instant
-- receive different numbers. A rolled-back save leaves a gap, which is correct:
-- designing against gaps is how duplicates get created.
CREATE OR REPLACE FUNCTION public.next_invoice_number(p_series TEXT DEFAULT 'WS')
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid := public.get_user_account_id();
  v_fy         TEXT := public.financial_year_label();
  v_next       INTEGER;
BEGIN
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No account for the current user' USING ERRCODE = '42501';
  END IF;
  IF p_series !~ '^[A-Z]{2,4}$' THEN
    RAISE EXCEPTION 'Series must be 2 to 4 capital letters' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.invoice_sequences (account_id, series, fy, last_number)
  VALUES (v_account_id, p_series, v_fy, 1)
  ON CONFLICT (account_id, series, fy)
  DO UPDATE SET last_number = public.invoice_sequences.last_number + 1
  RETURNING last_number INTO v_next;

  RETURN p_series || '/' || v_fy || '/' || lpad(v_next::text, 5, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_invoice_number(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_invoice_number(TEXT) TO authenticated;

COMMENT ON FUNCTION public.next_invoice_number IS
  'Returns the next sequential invoice number for the caller''s account, e.g. WS/26-27/00001. Gaps are expected; duplicates are impossible.';

-- ---------------------------------------------------------------------------
-- 7. record_sales_return: carry the wholesale identity onto the credit note
--
-- Two changes against 20260910400000:
--   * the INSERT now copies sale_type and the wholesale buyer snapshot, so a
--     wholesale return is no longer filed as retail
--   * the tax reversal mirrors the original line's own split rather than
--     recomputing it from accounts.is_interstate_billing. An interstate
--     wholesale invoice was previously reversed as CGST + SGST whenever the
--     account-wide flag was off, which unbalanced both sides of the return
-- ---------------------------------------------------------------------------
-- The signature must match the existing function exactly, defaults included.
-- CREATE OR REPLACE cannot remove a parameter default (42P13), so dropping
-- DEFAULT 'salable' here would fail against any database that already has
-- 20260910400000 or APPLY_ALL_compliance.sql applied.
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

  -- Mirror the original line. A bill taxed as IGST must be credited as IGST,
  -- whatever the account-wide flag says today, because that flag can be changed
  -- between the sale and the return. Only fall back to the account setting for
  -- rows written before the split columns existed.
  IF COALESCE(v_sale.igst_amount, 0) <> 0 THEN
    v_igst := v_gst;
  ELSIF COALESCE(v_sale.cgst_amount, 0) <> 0 OR COALESCE(v_sale.sgst_amount, 0) <> 0 THEN
    v_cgst := ROUND(v_gst / 2, 2);
    v_sgst := v_gst - v_cgst;
  ELSE
    SELECT COALESCE(a.is_interstate_billing, false) INTO v_interstate
      FROM accounts a WHERE a.id = v_account_id;
    IF v_interstate THEN
      v_igst := v_gst;
    ELSE
      v_cgst := ROUND(v_gst / 2, 2);
      v_sgst := v_gst - v_cgst;
    END IF;
  END IF;

  -- Negative reversal row. Every money column is negated; the trigger decides
  -- whether products.quantity moves.
  INSERT INTO sales (
    account_id, product_id, user_id,
    quantity, unit_price, total_price, gst_amount,
    taxable_value, gst_rate, cgst_amount, sgst_amount, igst_amount,
    hsn_code, batch_id, cogs_rate,
    bill_id, customer_name, customer_phone,
    return_type, returned_from_sale_id, return_reason,
    sale_type, wholesale_customer_name, wholesale_customer_gstin,
    wholesale_customer_dl, wholesale_customer_dl_expiry, buyer_state_code,
    bill_serial, is_free
  ) VALUES (
    v_sale.account_id, v_sale.product_id, COALESCE(v_sale.user_id, auth.uid()),
    -p_quantity, v_sale.unit_price, -v_total, -v_gst,
    -v_taxable, v_sale.gst_rate, -v_cgst, -v_sgst, -v_igst,
    v_sale.hsn_code, v_sale.batch_id, v_sale.cogs_rate,
    v_sale.bill_id, v_sale.customer_name, v_sale.customer_phone,
    p_return_type, p_sale_id, p_reason,
    COALESCE(v_sale.sale_type, 'retail'), v_sale.wholesale_customer_name, v_sale.wholesale_customer_gstin,
    v_sale.wholesale_customer_dl, v_sale.wholesale_customer_dl_expiry, v_sale.buyer_state_code,
    v_sale.bill_serial, COALESCE(v_sale.is_free, false)
  ) RETURNING id INTO v_return_id;

  -- Batch ledger: only salable goods rejoin the FEFO queue.
  IF p_return_type = 'salable' THEN
    IF v_sale.batch_id IS NOT NULL THEN
      UPDATE stock_batches
        SET qty_available = qty_available + p_quantity
        WHERE id = v_sale.batch_id;
    ELSE
      SELECT b.batch_number INTO v_batch_number
        FROM stock_batches b
        WHERE b.account_id = v_account_id AND b.product_id = v_sale.product_id
        ORDER BY b.expiry_date ASC LIMIT 1;

      PERFORM public.adjust_batch_stock(
        v_account_id, v_sale.product_id, v_batch_number, p_quantity
      );
    END IF;
  END IF;

  RETURN v_return_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_sales_return(uuid, numeric, text, text) TO authenticated;

COMMENT ON FUNCTION public.record_sales_return IS
  'Books a customer return as a negative sales row. Salable returns restock; expired and damaged are written off. Rejects over-returning. Carries the original sale_type and wholesale buyer identity, and mirrors the original tax split.';

-- ---------------------------------------------------------------------------
-- 8. Indexes
--
-- The composite below backs Recent Sales, which orders by created_at on every
-- visit to the Sales page and had no supporting index, and the Wholesale
-- Reports channel filter. The two dropped indexes are exact duplicates of
-- indexes that already exist; they were paid for on every inserted line and
-- earned nothing, which matters when one wholesale invoice is eighty rows.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sales_account_date
  ON public.sales (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_account_type_date
  ON public.sales (account_id, sale_type, created_at DESC);

DROP INDEX IF EXISTS public.idx_sales_customer_phone_new;
DROP INDEX IF EXISTS public.idx_sales_sale_date_new;

COMMIT;
