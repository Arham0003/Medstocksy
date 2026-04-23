-- ============================================================
-- Purchase Returns Table
-- Run this in: https://app.supabase.com/project/yuqvtucvqivvvpcfflhq/sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.purchase_returns (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  supplier_id    UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  product_id     UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  purchase_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  return_amount  NUMERIC(10,2) NOT NULL DEFAULT 0,
  reason         TEXT,
  return_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  batch_number   TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.purchase_returns ENABLE ROW LEVEL SECURITY;

-- RLS Policy
CREATE POLICY "Users manage own purchase returns"
  ON public.purchase_returns
  FOR ALL
  TO authenticated
  USING (account_id = public.get_user_account_id())
  WITH CHECK (account_id = public.get_user_account_id());

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pr_supplier  ON public.purchase_returns(supplier_id);
CREATE INDEX IF NOT EXISTS idx_pr_product   ON public.purchase_returns(product_id);
CREATE INDEX IF NOT EXISTS idx_pr_account   ON public.purchase_returns(account_id);
CREATE INDEX IF NOT EXISTS idx_pr_date      ON public.purchase_returns(return_date);
