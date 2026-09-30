-- =====================================================================
--  MEDSTOCKSY - LEAN GST COMPLIANCE  (all 10 steps, one file)
--
--  Paste this whole file into the Supabase SQL editor and Run once.
--
--  * Wrapped in a single transaction: if ANY step fails, everything
--    rolls back and your database is left exactly as it was.
--  * Idempotent: safe to run again if you are unsure whether it took.
--  * Verified end to end on PostgreSQL 17.6 before shipping.
--
--  TAKE A BACKUP FIRST (Dashboard -> Database -> Backups). Step 2
--  creates the table everything else depends on.
--
--  Source files, applied in this order:
--    1/10  HSN master + account GST identity              20260910000000_create_hsn_codes.sql
--    2/10  stock_batches FEFO ledger                      20260910100000_create_stock_batches.sql
--    3/10  Freeze existing stock as OPENING batches       20260910150000_backfill_opening_stock_batches.sql
--    4/10  GST split on sales + ITC on purchase_returns   20260910200000_add_gst_split_columns.sql
--    5/10  add_stock_batch() - effective_cost             20260910250000_create_add_stock_batch.sql
--    6/10  deduct_fefo() - FEFO + expiry guard            20260910300000_create_deduct_fefo.sql
--    7/10  adjust_batch_stock() helper                    20260910320000_create_adjust_batch_stock.sql
--    8/10  Purchase return ITC reversal                   20260910350000_purchase_return_itc_and_batches.sql
--    9/10  record_sales_return() + trigger patch          20260910400000_patch_sales_return.sql
--    10/10 Seed common pharma HSN codes                   seed_hsn_codes.sql
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- STEP 1/10  HSN master + account GST identity
-- source: supabase/migrations/20260910000000_create_hsn_codes.sql
-- ---------------------------------------------------------------------

-- ============================================================
-- Migration 1 - HSN Codes Master + Account GST Identity
-- Plan: Lean Compliance Plan, Phase A / Migration 1
--
-- Adds:
--   * public.hsn_codes  - per-account HSN → GST rate lookup (GSTR-1 source of truth)
--   * products.hsn_code - already present in 20260129000000_add_pharmacy_fields.sql,
--                         kept here as an idempotent no-op so this file stands alone
--   * accounts.state_code / accounts.is_interstate_billing
--
-- Interstate decision (plan Q2): default FALSE - CGST + SGST always.
-- The flag lives at ACCOUNT level, not per sale. Flip it in Settings if the
-- store starts billing institutions in another state.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.hsn_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  hsn         text NOT NULL,
  description text,
  gst_rate    numeric(5,2) NOT NULL DEFAULT 12 CHECK (gst_rate >= 0 AND gst_rate <= 100),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, hsn)
);

ALTER TABLE public.hsn_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_hsn" ON public.hsn_codes;
CREATE POLICY "users_manage_hsn" ON public.hsn_codes
  FOR ALL
  TO authenticated
  USING (account_id = public.get_user_account_id())
  WITH CHECK (account_id = public.get_user_account_id());

CREATE INDEX IF NOT EXISTS idx_hsn_account ON public.hsn_codes(account_id);

COMMENT ON TABLE  public.hsn_codes            IS 'Per-account HSN master. Single source of truth for GST rate on GSTR-1.';
COMMENT ON COLUMN public.hsn_codes.gst_rate   IS 'Total GST %. Split 50/50 into CGST+SGST for intra-state, or booked as IGST when the account bills interstate.';

-- ------------------------------------------------------------
-- products.hsn_code - ties a product to its HSN rate.
-- Already added by 20260129000000_add_pharmacy_fields.sql; no-op there.
-- products.gst is retained as the fallback rate for products with no HSN.
-- ------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS hsn_code text;

COMMENT ON COLUMN public.products.hsn_code IS 'HSN code. Looks up hsn_codes.gst_rate; products.gst is the fallback when unset.';

-- ------------------------------------------------------------
-- Account-level GST identity
-- ------------------------------------------------------------
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS state_code            char(2),
  ADD COLUMN IF NOT EXISTS is_interstate_billing boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.accounts.state_code            IS 'Two-digit GST state code of the store (e.g. 27 = Maharashtra).';
COMMENT ON COLUMN public.accounts.is_interstate_billing IS 'FALSE (default) = CGST+SGST on every bill. TRUE = IGST. Account-wide, no per-bill override.';

-- HSN seed data is intentionally NOT run here - see supabase/seed_hsn_codes.sql.

-- ---------------------------------------------------------------------
-- STEP 2/10  stock_batches FEFO ledger
-- source: supabase/migrations/20260910100000_create_stock_batches.sql
-- ---------------------------------------------------------------------

-- ============================================================
-- Migration 2 - Stock Batches (FEFO ledger)
-- Plan: Lean Compliance Plan, Phase A / Migration 2
--
-- !! TAKE A SUPABASE BACKUP BEFORE RUNNING. !!
--
-- products.quantity stays the aggregate on-hand figure that the existing UI
-- and the sales trigger read. stock_batches is the per-batch ledger layered
-- underneath it: FEFO order, per-batch cost, per-batch expiry.
-- The two are kept in step by add_stock_batch() and deduct_fefo().
-- ============================================================

CREATE TABLE IF NOT EXISTS public.stock_batches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  product_id          uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,

  -- Batch identity
  batch_number        text NOT NULL,
  expiry_date         date NOT NULL,
  mfg_date            date,
  manufacturer        text,

  -- Quantities
  qty_purchased       numeric(10,3) NOT NULL,
  qty_free            numeric(10,3) NOT NULL DEFAULT 0,
  qty_available       numeric(10,3) NOT NULL CHECK (qty_available >= 0),

  -- Valuation
  invoice_rate        numeric(10,4) NOT NULL,
  trade_discount_pct  numeric(5,2)  NOT NULL DEFAULT 0,
  -- effective_cost = (qty_purchased x invoice_rate x (1 - disc/100)) / (qty_purchased + qty_free)
  effective_cost      numeric(10,4) NOT NULL,

  -- Pricing / tax
  mrp                 numeric(10,2) NOT NULL,
  hsn_code            text,
  gst_rate            numeric(5,2)  NOT NULL DEFAULT 12,

  -- Provenance
  supplier_id         uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  invoice_no          text,
  source              text NOT NULL DEFAULT 'purchase'
                      CHECK (source IN ('purchase', 'opening', 'adjustment', 'return')),

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- Re-purchasing the same batch of the same product tops up the existing row
  -- instead of creating a duplicate. See add_stock_batch().
  CONSTRAINT stock_batches_identity_uniq UNIQUE (account_id, product_id, batch_number, expiry_date)
);

ALTER TABLE public.stock_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_batches" ON public.stock_batches;
CREATE POLICY "users_manage_batches" ON public.stock_batches
  FOR ALL
  TO authenticated
  USING (account_id = public.get_user_account_id())
  WITH CHECK (account_id = public.get_user_account_id());

-- FEFO index: nearest expiry first, only rows that still hold stock
CREATE INDEX IF NOT EXISTS idx_batches_fefo ON public.stock_batches
  (account_id, product_id, expiry_date ASC)
  WHERE qty_available > 0;

CREATE INDEX IF NOT EXISTS idx_batches_product ON public.stock_batches(product_id);
CREATE INDEX IF NOT EXISTS idx_batches_expiry  ON public.stock_batches(account_id, expiry_date);

-- updated_at housekeeping
CREATE OR REPLACE FUNCTION public.touch_stock_batches_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_stock_batches ON public.stock_batches;
CREATE TRIGGER trg_touch_stock_batches
  BEFORE UPDATE ON public.stock_batches
  FOR EACH ROW EXECUTE FUNCTION public.touch_stock_batches_updated_at();

COMMENT ON TABLE  public.stock_batches                IS 'Per-batch stock ledger. FEFO consumption, Ind AS 2 per-batch cost, Drugs Act traceability.';
COMMENT ON COLUMN public.stock_batches.effective_cost IS 'Landed cost per saleable unit AFTER trade discount and free goods. This is the COGS rate.';
COMMENT ON COLUMN public.stock_batches.qty_available  IS 'Units still sellable from this batch. Decremented by deduct_fefo().';
COMMENT ON COLUMN public.stock_batches.source         IS 'purchase = normal inward | opening = pre-batch legacy stock | adjustment = manual | return = customer return back to stock.';

-- ---------------------------------------------------------------------
-- STEP 3/10  Freeze existing stock as OPENING batches
-- source: supabase/migrations/20260910150000_backfill_opening_stock_batches.sql
-- ---------------------------------------------------------------------

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

-- ---------------------------------------------------------------------
-- STEP 4/10  GST split on sales + ITC on purchase_returns
-- source: supabase/migrations/20260910200000_add_gst_split_columns.sql
-- ---------------------------------------------------------------------

-- ============================================================
-- Migration 3 - GST split on sales + ITC columns on purchase returns
-- Plan: Lean Compliance Plan, Phase A / Migration 3
--
-- GSTR-1 needs taxable value and the CGST/SGST (or IGST) split stored per
-- line, not recomputed at report time from a rate that may since have moved.
-- ============================================================

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS taxable_value numeric(10,2),
  ADD COLUMN IF NOT EXISTS gst_rate      numeric(5,2),
  ADD COLUMN IF NOT EXISTS cgst_amount   numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount   numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount   numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hsn_code      text,
  ADD COLUMN IF NOT EXISTS batch_id      uuid REFERENCES public.stock_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cogs_rate     numeric(10,4);

-- 'salable' -> back to sellable stock | 'expired' / 'damaged' -> write-off, stock stays out
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS return_type text CHECK (
    return_type IS NULL OR return_type IN ('salable', 'expired', 'damaged')
  );

CREATE INDEX IF NOT EXISTS idx_sales_batch ON public.sales(batch_id);
CREATE INDEX IF NOT EXISTS idx_sales_hsn   ON public.sales(account_id, hsn_code);

COMMENT ON COLUMN public.sales.taxable_value IS 'Pre-tax line value. GSTR-1 HSN-wise summary sums this.';
COMMENT ON COLUMN public.sales.gst_rate      IS 'GST % applied to this line, frozen at sale time.';
COMMENT ON COLUMN public.sales.return_type   IS 'Only set on return rows (negative quantity). NULL on a normal sale.';
COMMENT ON COLUMN public.sales.batch_id      IS 'Batch this line was served from. Drives Drugs Act traceability and salable-return restock.';
COMMENT ON COLUMN public.sales.cogs_rate     IS 'effective_cost of the batch at sale time. Frozen so margin reports stay correct after later purchases.';

-- ------------------------------------------------------------
-- Purchase returns: ITC reversal amount for GSTR-3B
-- ------------------------------------------------------------
ALTER TABLE public.purchase_returns
  ADD COLUMN IF NOT EXISTS gst_rate    numeric(5,2)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_amount  numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cgst_amount numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount numeric(10,2) DEFAULT 0;

COMMENT ON COLUMN public.purchase_returns.gst_amount IS 'Input tax credit to be reversed in GSTR-3B for this return.';

-- ---------------------------------------------------------------------
-- STEP 5/10  add_stock_batch() - effective_cost
-- source: supabase/migrations/20260910250000_create_add_stock_batch.sql
-- ---------------------------------------------------------------------

-- ============================================================
-- B1 (adapted) - add_stock_batch()
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

-- ---------------------------------------------------------------------
-- STEP 6/10  deduct_fefo() - FEFO + expiry guard
-- source: supabase/migrations/20260910300000_create_deduct_fefo.sql
-- ---------------------------------------------------------------------

-- ============================================================
-- B2 - deduct_fefo()
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

-- ---------------------------------------------------------------------
-- STEP 7/10  adjust_batch_stock() helper
-- source: supabase/migrations/20260910320000_create_adjust_batch_stock.sql
-- ---------------------------------------------------------------------

-- ============================================================
-- adjust_batch_stock() - shared batch-ledger helper
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

-- ---------------------------------------------------------------------
-- STEP 8/10  Purchase return ITC reversal
-- source: supabase/migrations/20260910350000_purchase_return_itc_and_batches.sql
-- ---------------------------------------------------------------------

-- ============================================================
-- B3 - Purchase return: ITC reversal + batch ledger
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

-- ---------------------------------------------------------------------
-- STEP 9/10  record_sales_return() + trigger patch
-- source: supabase/migrations/20260910400000_patch_sales_return.sql
-- ---------------------------------------------------------------------

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

-- ---------------------------------------------------------------------
-- STEP 10/10 Seed common pharma HSN codes
-- source: supabase/seed_hsn_codes.sql
-- ---------------------------------------------------------------------

-- ============================================================
-- One-time DML - seed common pharma HSN codes for every account.
-- Run AFTER 20260910000000_create_hsn_codes.sql, in the Supabase SQL editor.
-- Safe to re-run: ON CONFLICT DO NOTHING keeps owner edits intact.
--
-- Rates below are the common pharma defaults. Verify against the current
-- CBIC rate notification before relying on them for a filed return.
-- ============================================================

INSERT INTO public.hsn_codes (account_id, hsn, description, gst_rate)
SELECT a.id, v.hsn, v.description, v.gst_rate
FROM public.accounts a
CROSS JOIN (VALUES
  ('30049099', 'Medicaments (general)',        12),
  ('30059010', 'Dressings / Bandages',          5),
  ('30061010', 'Surgical Gloves',               5),
  ('30049011', 'Ayurvedic medicines',          12),
  ('30021200', 'Antisera / Vaccines',           5),
  ('90183900', 'Syringes / Needles / Catheters',12),
  ('21069099', 'Food supplements',             18),
  ('33049990', 'Cosmetics / Skin care',        18),
  ('00000000', 'Exempt / Nil rated',            0)
) AS v(hsn, description, gst_rate)
ON CONFLICT (account_id, hsn) DO NOTHING;

COMMIT;

-- =====================================================================
--  POST-RUN CHECK - run this separately after the COMMIT above.
--  Expect: zero rows. Any row means the aggregate and the batch ledger
--  disagree for that product.
-- =====================================================================
-- SELECT p.name, p.quantity, COALESCE(SUM(b.qty_available), 0) AS batched
-- FROM products p LEFT JOIN stock_batches b ON b.product_id = p.id
-- GROUP BY p.id, p.name, p.quantity
-- HAVING p.quantity <> COALESCE(SUM(b.qty_available), 0);
