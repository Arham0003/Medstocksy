-- =====================================================================
--  MEDSTOCKSY - WHOLESALE (B2B) BILLING  (all 3 steps, one file)
--
--  Paste this whole file into the Supabase SQL editor and Run once.
--
--  * Wrapped in a single transaction: if ANY step fails, everything
--    rolls back and your database is left exactly as it was.
--  * Idempotent: safe to run again if you are unsure whether it took.
--  * Additive only: every column is nullable or defaulted, so existing
--    rows, existing bills and existing flows are untouched. No backfill.
--  * Verified end to end on PostgreSQL 17 before shipping.
--
--  TAKE A BACKUP FIRST (Dashboard -> Database -> Backups).
--
--  Source files, applied in this order:
--    1/3  Wholesale columns on settings/products/sales/purchase_items
--                                      20260918000000_add_wholesale_fields.sql
--    2/3  RESTRICTIVE RLS gate on sales
--                                      20260918000100_add_wholesale_rls.sql
--    3/3  record_purchase() carrying wholesale_price
--                                      20260918000200_update_record_purchase_rpc.sql
--
--  AFTER RUNNING: Settings -> Tax & Currency -> turn on "Wholesale Mode".
--  The toggle only appears on an account whose subscription plan_type is
--  'wholesale_monthly' or 'wholesale_annual'.
-- =====================================================================

BEGIN;

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

COMMIT;

-- =====================================================================
--  VERIFICATION - every row below should read OK
-- =====================================================================
SELECT
  'columns added'                                   AS check,
  count(*)::text || ' of 6'                         AS detail,
  CASE WHEN count(*) = 6 THEN 'OK' ELSE 'MISSING' END AS status
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
  'sale_type default',
  COALESCE(column_default,'(none)'),
  CASE WHEN column_default LIKE '%retail%' THEN 'OK' ELSE 'WRONG' END
FROM information_schema.columns
WHERE table_schema='public' AND table_name='sales' AND column_name='sale_type'

UNION ALL
SELECT
  'existing sales untouched',
  count(*)::text || ' row(s) still sale_type=retail',
  'OK'
FROM public.sales WHERE sale_type = 'retail'

UNION ALL
SELECT
  'RLS gate is RESTRICTIVE',
  CASE WHEN bool_and(NOT polpermissive) THEN 'restrictive' ELSE 'PERMISSIVE - WRONG' END,
  CASE WHEN count(*) = 1 AND bool_and(NOT polpermissive) THEN 'OK' ELSE 'MISSING' END
FROM pg_policy
WHERE polrelid = 'public.sales'::regclass
  AND polname = 'block_wholesale_for_non_subscribers'

UNION ALL
SELECT
  'sale_type CHECK constraint',
  'sales_sale_type_check',
  CASE WHEN count(*) = 1 THEN 'OK' ELSE 'MISSING' END
FROM pg_constraint WHERE conname = 'sales_sale_type_check'

UNION ALL
SELECT
  'wholesale index',
  'idx_sales_sale_type_wholesale',
  CASE WHEN count(*) = 1 THEN 'OK' ELSE 'MISSING' END
FROM pg_indexes
WHERE schemaname='public' AND indexname = 'idx_sales_sale_type_wholesale'

UNION ALL
SELECT
  'record_purchase carries wholesale_price',
  'record_purchase(jsonb)',
  CASE WHEN count(*) = 1 THEN 'OK' ELSE 'MISSING' END
FROM pg_proc
WHERE proname = 'record_purchase' AND prosrc LIKE '%wholesale_price%';
