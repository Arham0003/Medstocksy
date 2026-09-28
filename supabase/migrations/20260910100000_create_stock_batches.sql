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
