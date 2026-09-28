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
