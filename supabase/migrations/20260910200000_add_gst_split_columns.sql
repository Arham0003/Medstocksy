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
