-- ============================================================
-- Migration: wholesale billing fields
--
-- Adds the four columns the wholesale (B2B) flow needs. Every one
-- is additive with a safe default, so existing rows and existing
-- flows are untouched:
--   * settings.wholesale_mode      — account-level toggle (same pattern as gst_enabled)
--   * products.wholesale_price     — B2B rate, captured during purchase entry
--   * sales.sale_type              — 'retail' (default) | 'wholesale'
--   * purchase_items.wholesale_price — price history per purchase line
-- ============================================================

-- 1a. Wholesale mode toggle on settings (account-level, same pattern as gst_enabled).
--     Lives on `settings` because SalesBilling / RecordSale / Settings already
--     fetch that row — the billing path gains no extra round trip.
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS wholesale_mode BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.settings.wholesale_mode IS
  'When true (and an active wholesale subscription exists), wholesale billing, B2B fields and the free-qty column are shown.';

-- 1b. Wholesale price per product (set during purchase entry).
--     Nullable: products bought before this migration simply have none, and
--     wholesale billing falls back to selling_price for them.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS wholesale_price NUMERIC(10,2);

COMMENT ON COLUMN public.products.wholesale_price IS
  'B2B rate used as the default line rate on wholesale bills. NULL falls back to selling_price.';

-- 1c. sale_type on sales (DEFAULT 'retail' — zero cost for all existing data,
--     no backfill needed) plus the B2B buyer identity carried on each line.
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS sale_type TEXT NOT NULL DEFAULT 'retail',
  ADD COLUMN IF NOT EXISTS wholesale_customer_name TEXT,
  ADD COLUMN IF NOT EXISTS wholesale_customer_gstin TEXT;

COMMENT ON COLUMN public.sales.sale_type IS
  'retail (default) or wholesale. Drives the wholesale reports filter and the A4 tax-invoice layout.';

-- Guard against typos/other values sneaking in from a future caller.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_sale_type_check'
  ) THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_sale_type_check CHECK (sale_type IN ('retail', 'wholesale'));
  END IF;
END $$;

-- Wholesale reports filter on this column; keep the scan cheap.
-- Partial index — wholesale rows are the minority, retail rows need no entry.
CREATE INDEX IF NOT EXISTS idx_sales_sale_type_wholesale
  ON public.sales (sale_type)
  WHERE sale_type = 'wholesale';

-- 1d. wholesale_price history on purchase_items.
ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS wholesale_price NUMERIC(10,2);

COMMENT ON COLUMN public.purchase_items.wholesale_price IS
  'Wholesale price entered on this purchase line; mirrored onto products.wholesale_price.';
