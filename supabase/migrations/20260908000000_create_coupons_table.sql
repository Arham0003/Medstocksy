-- Coupon codes for Razorpay discount system
-- Admin creates rows here via Supabase Dashboard
-- Only edge functions (service_role) can read/update

CREATE TABLE IF NOT EXISTS coupons (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code           TEXT UNIQUE NOT NULL,                          -- e.g. "SAVE20", "MEDSTOCK100"
  discount_type  TEXT NOT NULL CHECK (discount_type IN ('flat', 'percent')),
  discount_value NUMERIC NOT NULL CHECK (discount_value > 0),  -- paise for flat, 1-100 for percent
  max_uses       INT NOT NULL DEFAULT 1,
  used_count     INT NOT NULL DEFAULT 0,
  expires_at     TIMESTAMPTZ,                                   -- NULL = never expires
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast code lookup
CREATE INDEX IF NOT EXISTS coupons_code_idx ON coupons (UPPER(code));

-- RLS: block all direct client access - only service_role (edge functions) can touch this table
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No direct client access" ON coupons
  FOR ALL
  USING (FALSE);
