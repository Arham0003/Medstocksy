-- ============================================================
-- Migration: platform admins may use wholesale without buying a plan
--
-- WHY
-- The wholesale gate required an active wholesale subscription. That locked
-- the platform owner out of their own feature: the Settings toggle never
-- appeared, and even if it had, the RESTRICTIVE policy on sales would have
-- rejected the insert. Requiring the owner to sell themselves a subscription
-- is not a sensible gate.
--
-- Platform admins (public.admin_users) now satisfy the wholesale check as
-- well. Customers are unaffected: they still need an active wholesale plan.
--
-- Guarded so it is safe to run in any order. If the wholesale columns or the
-- admin functions are not installed yet, it skips with a notice instead of
-- failing the whole sheet.
-- ============================================================

DO $$
DECLARE
  has_sale_type  BOOLEAN;
  has_admin_func BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sales' AND column_name = 'sale_type'
  ) INTO has_sale_type;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_platform_admin'
  ) INTO has_admin_func;

  IF NOT has_sale_type THEN
    RAISE NOTICE 'Skipping wholesale admin override: sales.sale_type not found. Run the wholesale sheet first.';
    RETURN;
  END IF;

  IF NOT has_admin_func THEN
    RAISE NOTICE 'Skipping wholesale admin override: is_platform_admin() not found. Run the admin sheet first.';
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "block_wholesale_for_non_subscribers" ON public.sales;

  CREATE POLICY "block_wholesale_for_non_subscribers"
    ON public.sales
    AS RESTRICTIVE
    FOR INSERT
    TO authenticated
    WITH CHECK (
      sale_type = 'retail'
      OR public.is_platform_admin()
      OR EXISTS (
        SELECT 1 FROM public.subscriptions
        WHERE user_id = auth.uid()
          AND status = 'active'
          AND plan_type IN ('wholesale_monthly', 'wholesale_annual')
      )
    );

  COMMENT ON POLICY "block_wholesale_for_non_subscribers" ON public.sales IS
    'Restrictive gate: wholesale sales require an active wholesale plan, or platform-admin status. Retail passes unconditionally.';

  RAISE NOTICE 'Wholesale admin override applied.';
END $$;
