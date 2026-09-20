-- ============================================================
-- Migration: DB-level gate for wholesale sales
--
-- A frontend bypass must still be blocked, so the check lives in RLS.
--
-- NOTE ON POLICY TYPE - this is deliberately RESTRICTIVE.
-- Postgres OR's *permissive* policies together, so adding a permissive
-- INSERT policy here would WIDEN access, not narrow it: the existing
-- "Users can create sales in their account" and "Owners can manage all
-- sales in their account" policies would still let a wholesale row through.
-- RESTRICTIVE policies are AND'ed with the permissive set, which is the
-- only way to actually deny the insert.
--
-- Retail inserts are unaffected: sale_type = 'retail' satisfies the check
-- outright, so every existing flow keeps working with no subscription read.
-- ============================================================

DROP POLICY IF EXISTS "block_wholesale_for_non_subscribers" ON public.sales;

CREATE POLICY "block_wholesale_for_non_subscribers"
  ON public.sales
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sale_type = 'retail'
    OR EXISTS (
      SELECT 1 FROM public.subscriptions
      WHERE user_id = auth.uid()
        AND status = 'active'
        AND plan_type IN ('wholesale_monthly', 'wholesale_annual')
    )
  );

COMMENT ON POLICY "block_wholesale_for_non_subscribers" ON public.sales IS
  'Restrictive gate: only accounts on an active wholesale plan may insert sale_type = ''wholesale''. Retail sales pass unconditionally.';
