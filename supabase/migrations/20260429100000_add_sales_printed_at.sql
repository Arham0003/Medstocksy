-- Lock-after-print: stamp the moment a bill is printed so we can disable
-- edits afterwards (compliance / audit trail).
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS printed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sales_printed_at ON public.sales (printed_at);
