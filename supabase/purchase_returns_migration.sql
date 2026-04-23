-- ============================================================
-- Purchase Returns Table
-- Tracks items returned back to suppliers
-- ============================================================

CREATE TABLE IF NOT EXISTS purchase_returns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  supplier_id     uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  product_id      uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity        integer NOT NULL CHECK (quantity > 0),
  purchase_price  numeric(10,2) NOT NULL DEFAULT 0,
  return_amount   numeric(10,2) NOT NULL DEFAULT 0,
  reason          text,
  return_date     date NOT NULL DEFAULT CURRENT_DATE,
  batch_number    text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE purchase_returns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own purchase returns"
  ON purchase_returns
  FOR ALL
  USING (account_id = (SELECT account_id FROM profiles WHERE id = auth.uid()))
  WITH CHECK (account_id = (SELECT account_id FROM profiles WHERE id = auth.uid()));

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_purchase_returns_supplier ON purchase_returns(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_product  ON purchase_returns(product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_account  ON purchase_returns(account_id);
