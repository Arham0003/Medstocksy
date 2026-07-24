-- Create purchase_headers table
CREATE TABLE IF NOT EXISTS public.purchase_headers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  supplier_id     uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_name   text,
  invoice_number  text NOT NULL,
  invoice_date    date NOT NULL DEFAULT CURRENT_DATE,
  due_date        date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.purchase_headers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'purchase_headers' AND policyname = 'Users can manage their own purchase headers'
  ) THEN
    CREATE POLICY "Users can manage their own purchase headers"
      ON public.purchase_headers FOR ALL
      USING (account_id = (SELECT account_id FROM public.profiles WHERE id = auth.uid()))
      WITH CHECK (account_id = (SELECT account_id FROM public.profiles WHERE id = auth.uid()));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_purchase_headers_account ON public.purchase_headers(account_id);
CREATE INDEX IF NOT EXISTS idx_purchase_headers_supplier ON public.purchase_headers(supplier_id);

-- Create purchase_items table
CREATE TABLE IF NOT EXISTS public.purchase_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_header_id uuid NOT NULL REFERENCES public.purchase_headers(id) ON DELETE CASCADE,
  name               text NOT NULL,
  hsn                text,
  batch              text,
  expiry             date,
  qty                numeric(10,2) NOT NULL DEFAULT 0,
  pcs_per_unit       integer,
  free_qty           numeric(10,2) NOT NULL DEFAULT 0,
  mrp                numeric(10,2),
  purchase_rate      numeric(10,2),
  discount_pct       numeric(5,2) DEFAULT 0,
  gst_pct            numeric(5,2) DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'purchase_items' AND policyname = 'Users can manage their own purchase items'
  ) THEN
    CREATE POLICY "Users can manage their own purchase items"
      ON public.purchase_items FOR ALL
      USING (purchase_header_id IN (SELECT id FROM public.purchase_headers WHERE account_id = (SELECT account_id FROM public.profiles WHERE id = auth.uid())))
      WITH CHECK (purchase_header_id IN (SELECT id FROM public.purchase_headers WHERE account_id = (SELECT account_id FROM public.profiles WHERE id = auth.uid())));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_purchase_items_header ON public.purchase_items(purchase_header_id);
