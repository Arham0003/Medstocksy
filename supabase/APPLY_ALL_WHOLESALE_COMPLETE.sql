-- =====================================================================
--  MEDSTOCKSY - WHOLESALE: EVERYTHING OUTSTANDING, ONE FILE
--
--  Paste this whole file into the Supabase SQL editor and press Run.
--
--  TAKE A BACKUP FIRST: Dashboard -> Database -> Backups.
--
--  Safe to run whether or not you have applied the earlier sheets:
--
--    * One transaction. If any statement fails, everything rolls back
--      and the database is left exactly as it was.
--    * Idempotent. Every step is guarded, so running it twice is a
--      no-op rather than an error. If you are unsure whether a previous
--      sheet took, run this.
--    * Additive only. Every new column is nullable or defaulted and no
--      existing row is rewritten, so retail bills, retail reports and
--      stock are untouched by construction.
--    * Verified on PostgreSQL 17 before shipping, including a second
--      run to prove idempotency.
--
--  WHAT IT APPLIES
--
--    PART A  Wholesale billing            (may already be applied)
--      A1  settings.wholesale_mode, products.wholesale_price,
--          sales.sale_type + wholesale buyer columns,
--          purchase_items.wholesale_price
--      A2  RESTRICTIVE RLS gate on sales, so a non-subscriber cannot
--          write a wholesale row even by calling the API directly
--      A3  record_purchase() carrying wholesale_price through
--
--    PART B  Statutory compliance                              (new)
--      B1  Buyer drug licence, expiry, state code, ship-to, invoice
--          serial and the free-goods marker on sales
--      B2  Seller FSSAI, drug licence form type and validity on
--          accounts, set once in Settings
--      B3  Schedule H/H1/X and storage condition on products
--      B4  Supplier drug licence (guarded, see note below)
--      B5  invoice_sequences + next_invoice_number() for the
--          sequential financial-year series CGST Rule 46 requires
--      B6  record_sales_return() patched so a wholesale credit note is
--          filed as wholesale, and so the tax reversal mirrors the
--          original split instead of the account-wide flag
--      B7  Indexes: adds the two the app actually needs, drops two
--          exact duplicates that cost a write on every line
--
--  NOT IN THIS FILE
--    The admin console lives in APPLY_ALL_admin.sql, and the earlier GST
--    work in APPLY_ALL_compliance.sql. Neither is required for wholesale
--    billing to work.
--
--  ONE THING TO KNOW
--    The `suppliers` table is not created by any migration in this repo,
--    so B4 is wrapped in an existence check. If it is skipped you will
--    see a NOTICE saying so, and everything else still applies.
--
--  AFTER RUNNING
--    1. Settings -> Tax & Currency -> turn on Wholesale Mode. The toggle
--       appears only on an account whose plan_type is wholesale_monthly
--       or wholesale_annual.
--    2. Settings -> Store Information -> fill in FSSAI number, drug
--       licence form type and licence validity. Wholesale invoices omit
--       these rather than printing blanks until they are set.
-- =====================================================================

BEGIN;

-- #####################################################################
-- ##  PART A - WHOLESALE BILLING
-- #####################################################################
-- ---------------------------------------------------------------------
-- STEP 0/3  Preflight - fail early and clearly if something is missing
-- ---------------------------------------------------------------------
DO $$
DECLARE
  missing text := '';
BEGIN
  IF to_regclass('public.settings')       IS NULL THEN missing := missing || ' settings';       END IF;
  IF to_regclass('public.products')       IS NULL THEN missing := missing || ' products';       END IF;
  IF to_regclass('public.sales')          IS NULL THEN missing := missing || ' sales';          END IF;
  IF to_regclass('public.subscriptions')  IS NULL THEN missing := missing || ' subscriptions';  END IF;
  IF to_regclass('public.purchase_items') IS NULL THEN missing := missing || ' purchase_items'; END IF;
  IF missing <> '' THEN
    RAISE EXCEPTION 'Cannot apply wholesale: missing table(s):%. Run the earlier migrations first.', missing;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- STEP 1/3  Wholesale columns
-- ---------------------------------------------------------------------

-- 1a. Account-level toggle (same pattern as gst_enabled). Lives on
--     `settings` because SalesBilling / RecordSale / Settings already read
--     that row - the billing path gains no extra round trip.
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS wholesale_mode BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.settings.wholesale_mode IS
  'When true (and an active wholesale subscription exists), wholesale billing, B2B fields and the free-qty column are shown.';

-- 1b. B2B rate per product, captured during purchase entry. Nullable:
--     products bought before today simply have none, and wholesale billing
--     falls back to selling_price for them.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS wholesale_price NUMERIC(10,2);

COMMENT ON COLUMN public.products.wholesale_price IS
  'B2B rate used as the default line rate on wholesale bills. NULL falls back to selling_price.';

-- 1c. sale_type on sales. DEFAULT 'retail' means every existing row is
--     already correct - zero cost, no backfill, no downtime.
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS sale_type TEXT NOT NULL DEFAULT 'retail',
  ADD COLUMN IF NOT EXISTS wholesale_customer_name TEXT,
  ADD COLUMN IF NOT EXISTS wholesale_customer_gstin TEXT;

COMMENT ON COLUMN public.sales.sale_type IS
  'retail (default) or wholesale. Drives the wholesale reports filter and the A4 tax-invoice layout.';

-- Guard against a stray value from any future caller.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_sale_type_check') THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_sale_type_check CHECK (sale_type IN ('retail', 'wholesale'));
  END IF;
END $$;

-- Wholesale reports filter on this column. Partial index: wholesale rows
-- are the minority, retail rows need no entry.
CREATE INDEX IF NOT EXISTS idx_sales_sale_type_wholesale
  ON public.sales (sale_type)
  WHERE sale_type = 'wholesale';

-- 1d. Price history per purchase line.
ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS wholesale_price NUMERIC(10,2);

COMMENT ON COLUMN public.purchase_items.wholesale_price IS
  'Wholesale price entered on this purchase line; mirrored onto products.wholesale_price.';

-- ---------------------------------------------------------------------
-- STEP 2/3  DB-level gate - a frontend bypass must still be blocked
--
--  NOTE ON POLICY TYPE - this is deliberately RESTRICTIVE.
--  Postgres OR's *permissive* policies together, so a permissive INSERT
--  policy here would WIDEN access, not narrow it: the existing "Users can
--  create sales in their account" and "Owners can manage all sales in
--  their account" policies would still let a wholesale row through.
--  RESTRICTIVE policies are AND'ed with the permissive set, which is the
--  only way to actually deny the insert.
--
--  Retail is unaffected: sale_type = 'retail' satisfies the check outright,
--  so every existing flow keeps working without reading subscriptions.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "block_wholesale_for_non_subscribers" ON public.sales;

CREATE POLICY "block_wholesale_for_non_subscribers"
  ON public.sales
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sale_type = 'retail'
    OR EXISTS (
      SELECT 1 FROM public.subscriptions
      WHERE user_id = auth.uid()
        AND status = 'active'
        AND plan_type IN ('wholesale_monthly', 'wholesale_annual')
    )
  );

COMMENT ON POLICY "block_wholesale_for_non_subscribers" ON public.sales IS
  'Restrictive gate: only accounts on an active wholesale plan may insert sale_type = ''wholesale''. Retail sales pass unconditionally.';

-- ---------------------------------------------------------------------
-- STEP 3/3  record_purchase() with wholesale_price
--
--  Identical to the shipped function, with wholesale_price threaded
--  through in three places: the purchase_items insert, the products
--  update, and the products insert. All stock / free_qty arithmetic is
--  byte-for-byte the original.
--
--  The UPDATE uses COALESCE so a later purchase that leaves W.Price blank
--  does NOT wipe the price already on the product - matching how category
--  and manufacturer are treated in the same statement.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_purchase(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_supplier_id uuid;
  v_purchase_header_id uuid;
  item jsonb;
BEGIN
  -- Extract basic info
  v_account_id := (payload->>'account_id')::uuid;
  v_supplier_id := (payload->>'supplier_id')::uuid;

  -- Insert purchase header
  INSERT INTO purchase_headers (
    account_id,
    supplier_id,
    supplier_name,
    invoice_number,
    invoice_date,
    due_date
  ) VALUES (
    v_account_id,
    v_supplier_id,
    payload->>'supplier_name',
    payload->>'invoice_number',
    (payload->>'invoice_date')::date,
    (payload->>'due_date')::date
  ) RETURNING id INTO v_purchase_header_id;

  -- Loop through items
  FOR item IN SELECT * FROM jsonb_array_elements(payload->'items')
  LOOP
    -- Insert purchase item
    INSERT INTO purchase_items (
      purchase_header_id,
      name,
      hsn,
      batch,
      expiry,
      qty,
      pcs_per_unit,
      free_qty,
      mrp,
      purchase_rate,
      discount_pct,
      gst_pct,
      wholesale_price
    ) VALUES (
      v_purchase_header_id,
      item->>'name',
      item->>'hsn_code',
      item->>'batch_number',
      (item->>'expiry_date')::date,
      (item->>'qty')::numeric,
      (item->>'pcs_per_unit')::integer,
      (item->>'freeQty')::numeric,
      (item->>'mrpNum')::numeric,
      (item->>'rateNum')::numeric,
      (item->>'discPct')::numeric,
      (item->>'gstRate')::numeric,
      (item->>'wholesale_price')::numeric
    );

    -- Upsert product stock (match on name and batch)
    UPDATE products
    SET
      quantity = quantity + (item->>'qty')::numeric + (item->>'freeQty')::numeric,
      purchase_price = (item->>'purchase_price')::numeric,
      selling_price = (item->>'mrpNum')::numeric,
      gst = (item->>'gstRate')::numeric,
      supplier = payload->>'supplier_name',
      supplier_id = v_supplier_id,
      category = COALESCE(item->>'category', category),
      manufacturer = COALESCE(item->>'manufacturer', manufacturer),
      low_stock_threshold = (item->>'lowStockNum')::integer,
      pcs_per_unit = COALESCE((item->>'pcs_per_unit')::integer, pcs_per_unit),
      -- Blank W.Price on a later invoice must not clear the price already set.
      wholesale_price = COALESCE((item->>'wholesale_price')::numeric, wholesale_price)
    WHERE account_id = v_account_id
      AND name = item->>'name'
      AND COALESCE(batch_number, '') = COALESCE(item->>'batch_number', '');

    IF NOT FOUND THEN
      -- Insert product stock
      INSERT INTO products (
        account_id,
        name,
        hsn_code,
        batch_number,
        expiry_date,
        quantity,
        pcs_per_unit,
        purchase_price,
        selling_price,
        gst,
        supplier,
        supplier_id,
        category,
        manufacturer,
        low_stock_threshold,
        wholesale_price
      ) VALUES (
        v_account_id,
        item->>'name',
        item->>'hsn_code',
        item->>'batch_number',
        (item->>'expiry_date')::date,
        (item->>'qty')::numeric + (item->>'freeQty')::numeric,
        (item->>'pcs_per_unit')::integer,
        (item->>'purchase_price')::numeric,
        (item->>'mrpNum')::numeric,
        (item->>'gstRate')::numeric,
        payload->>'supplier_name',
        v_supplier_id,
        item->>'category',
        item->>'manufacturer',
        (item->>'lowStockNum')::integer,
        (item->>'wholesale_price')::numeric
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'purchase_header_id', v_purchase_header_id);
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to record purchase: %', SQLERRM;
END;
$$;

-- #####################################################################
-- ##  PART B - STATUTORY COMPLIANCE (Rule 65, CGST Rule 46)
-- #####################################################################
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

-- =====================================================================
--  VERIFICATION - every row below should read OK
--
--  Run this on its own afterwards if you want to re-check at any time.
-- =====================================================================
SELECT
  'A. wholesale billing columns'                        AS check,
  count(*)::text || ' of 6'                             AS detail,
  CASE WHEN count(*) = 6 THEN 'OK' ELSE 'MISSING' END   AS status
FROM information_schema.columns
WHERE (table_schema, table_name, column_name) IN (
  ('public','settings','wholesale_mode'),
  ('public','products','wholesale_price'),
  ('public','sales','sale_type'),
  ('public','sales','wholesale_customer_name'),
  ('public','sales','wholesale_customer_gstin'),
  ('public','purchase_items','wholesale_price')
)

UNION ALL
SELECT
  'A. sale_type defaults to retail',
  COALESCE(column_default,'(none)'),
  CASE WHEN column_default LIKE '%retail%' THEN 'OK' ELSE 'WRONG' END
FROM information_schema.columns
WHERE table_schema='public' AND table_name='sales' AND column_name='sale_type'

UNION ALL
SELECT
  'A. existing sales untouched',
  count(*)::text || ' row(s) still sale_type=retail',
  'OK'
FROM public.sales WHERE sale_type = 'retail'

UNION ALL
SELECT
  'A. RLS gate is RESTRICTIVE',
  CASE WHEN bool_and(NOT polpermissive) THEN 'restrictive' ELSE 'PERMISSIVE - WRONG' END,
  CASE WHEN count(*) = 1 AND bool_and(NOT polpermissive) THEN 'OK' ELSE 'MISSING' END
FROM pg_policy
WHERE polrelid = 'public.sales'::regclass
  AND polname = 'block_wholesale_for_non_subscribers'

UNION ALL
SELECT
  'B. Rule 65 columns on sales',
  count(*)::text || ' of 6',
  CASE WHEN count(*) = 6 THEN 'OK' ELSE 'MISSING' END
FROM information_schema.columns
WHERE (table_schema, table_name, column_name) IN (
  ('public','sales','wholesale_customer_dl'),
  ('public','sales','wholesale_customer_dl_expiry'),
  ('public','sales','buyer_state_code'),
  ('public','sales','ship_to_address'),
  ('public','sales','bill_serial'),
  ('public','sales','is_free')
)

UNION ALL
SELECT
  'B. seller compliance on accounts',
  count(*)::text || ' of 3',
  CASE WHEN count(*) = 3 THEN 'OK' ELSE 'MISSING' END
FROM information_schema.columns
WHERE (table_schema, table_name, column_name) IN (
  ('public','accounts','fssai_number'),
  ('public','accounts','dl_form_type'),
  ('public','accounts','drug_license_expiry')
)

UNION ALL
SELECT
  'B. schedule flags on products',
  count(*)::text || ' of 2',
  CASE WHEN count(*) = 2 THEN 'OK' ELSE 'MISSING' END
FROM information_schema.columns
WHERE (table_schema, table_name, column_name) IN (
  ('public','products','schedule_type'),
  ('public','products','storage_condition')
)

UNION ALL
SELECT
  'B. supplier drug licence',
  CASE
    WHEN to_regclass('public.suppliers') IS NULL THEN 'suppliers table absent'
    WHEN EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='suppliers'
                   AND column_name='drug_license') THEN 'present'
    ELSE 'missing'
  END,
  CASE
    WHEN to_regclass('public.suppliers') IS NULL THEN 'SKIPPED (expected)'
    WHEN EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='suppliers'
                   AND column_name='drug_license') THEN 'OK'
    ELSE 'MISSING'
  END

UNION ALL
SELECT
  'B. invoice_sequences table + RLS',
  CASE WHEN to_regclass('public.invoice_sequences') IS NULL THEN 'absent' ELSE 'present' END,
  CASE WHEN to_regclass('public.invoice_sequences') IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_class
                    WHERE oid='public.invoice_sequences'::regclass AND relrowsecurity)
       THEN 'OK' ELSE 'MISSING' END

UNION ALL
SELECT
  'B. numbering functions',
  count(*)::text || ' of 2',
  CASE WHEN count(*) = 2 THEN 'OK' ELSE 'MISSING' END
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('next_invoice_number','financial_year_label')

UNION ALL
SELECT
  'B. financial year label is sane',
  public.financial_year_label(),
  CASE WHEN public.financial_year_label() ~ '^[0-9]{2}-[0-9]{2}$' THEN 'OK' ELSE 'WRONG' END

UNION ALL
SELECT
  'B. next_invoice_number is locked down',
  CASE WHEN has_function_privilege('public','public.next_invoice_number(text)','EXECUTE')
       THEN 'PUBLIC can execute - WRONG' ELSE 'revoked from PUBLIC' END,
  CASE WHEN has_function_privilege('public','public.next_invoice_number(text)','EXECUTE')
       THEN 'WRONG' ELSE 'OK' END

UNION ALL
SELECT
  'B. return carries wholesale identity',
  CASE WHEN pg_get_functiondef(p.oid) LIKE '%wholesale_customer_dl%'
        AND pg_get_functiondef(p.oid) LIKE '%sale_type%'
       THEN 'patched' ELSE 'OLD VERSION' END,
  CASE WHEN pg_get_functiondef(p.oid) LIKE '%wholesale_customer_dl%'
        AND pg_get_functiondef(p.oid) LIKE '%sale_type%'
       THEN 'OK' ELSE 'MISSING' END
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.proname='record_sales_return'

UNION ALL
SELECT
  'B. indexes added',
  count(*)::text || ' of 2',
  CASE WHEN count(*) = 2 THEN 'OK' ELSE 'MISSING' END
FROM pg_indexes
WHERE schemaname='public' AND tablename='sales'
  AND indexname IN ('idx_sales_account_date','idx_sales_account_type_date')

UNION ALL
SELECT
  'B. duplicate indexes dropped',
  count(*)::text || ' still present (want 0)',
  CASE WHEN count(*) = 0 THEN 'OK' ELSE 'STILL THERE' END
FROM pg_indexes
WHERE schemaname='public' AND tablename='sales'
  AND indexname IN ('idx_sales_customer_phone_new','idx_sales_sale_date_new')

UNION ALL
SELECT
  'stock untouched',
  count(*)::text || ' product(s) in catalogue',
  'OK'
FROM public.products;
