-- Fix: wholesale RLS policy must accept trial_wholesale_* plans.
--
-- Root cause: production has the policy from 20260919020000 which checks
-- plan_type IN ('wholesale_monthly', 'wholesale_annual') only.  When a
-- user is granted a trial_wholesale_N_days plan the RLS gate rejects the
-- INSERT with "new row violates row-level security policy
-- block_wholesale_for_non_subscribers".
--
-- The correct policy was written in 20260919040000_wholesale_trials.sql but
-- was never applied to production.  This migration re-applies it safely.

-- 1. Ensure plan_has_wholesale() exists (idempotent).
CREATE OR REPLACE FUNCTION public.plan_has_wholesale(p TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p IN ('wholesale_monthly', 'wholesale_annual')
      OR p LIKE 'trial\_wholesale\_%';
$$;

COMMENT ON FUNCTION public.plan_has_wholesale(TEXT) IS
  'True for paid wholesale plans and for wholesale trials. The one definition of wholesale entitlement.';

GRANT EXECUTE ON FUNCTION public.plan_has_wholesale(TEXT) TO authenticated, anon;

-- 2. Re-apply the RLS policy that uses plan_has_wholesale().
--    Guarded so it no-ops gracefully if the wholesale columns are absent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sales' AND column_name = 'sale_type'
  ) THEN
    RAISE NOTICE 'Skipping: sales.sale_type not found.';
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
          AND public.plan_has_wholesale(plan_type)
      )
    );

  COMMENT ON POLICY "block_wholesale_for_non_subscribers" ON public.sales IS
    'Restrictive gate: wholesale sales need a wholesale plan or trial, or platform-admin status. Retail passes unconditionally.';

  RAISE NOTICE 'block_wholesale_for_non_subscribers updated to accept trial plans.';
END $$;
