-- ============================================================
-- Migration: wholesale trials
--
-- The owner needs to hand out a wholesale trial without charging for it.
-- Writing 'wholesale_monthly' would work for access, but the admin panel
-- would then count a free trial as Rs.599 of recurring revenue. So wholesale
-- trials get their own plan_type, 'trial_wholesale_<days>_days', which:
--   * satisfies the wholesale gate (this migration)
--   * counts as a Trial, not as Paid (plan_type LIKE 'trial%' already)
--   * contributes 0 to MRR (the CASE in admin_overview_stats has no branch
--     for it, so it falls through to 0)
--
-- One predicate, plan_has_wholesale(), is the single answer to "does this
-- plan include wholesale", used by the RLS policy, the stats and the
-- segments, so the three can never disagree.
-- ============================================================

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

-- ─── 1. The RLS gate now accepts wholesale trials ────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sales' AND column_name = 'sale_type'
  ) THEN
    RAISE NOTICE 'Skipping: sales.sale_type not found. Run the wholesale sheet first.';
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
END $$;

-- ─── 2. Stats count wholesale trials as wholesale, but not as revenue ─
CREATE OR REPLACE FUNCTION public.admin_overview_stats()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  PERFORM public.require_platform_admin();

  WITH live AS (
    SELECT * FROM public.subscriptions
    WHERE status = 'active'
      AND (current_period_end IS NULL OR current_period_end > NOW())
  ),
  valued AS (
    SELECT plan_type,
           CASE plan_type
             WHEN 'professional_monthly' THEN 499
             WHEN 'professional_annual'  THEN 500
             WHEN 'wholesale_monthly'    THEN 599
             WHEN 'wholesale_annual'     THEN 600
             WHEN 'testing_weekly'       THEN 50
             ELSE 0
           END AS monthly_value
    FROM live
  )
  SELECT jsonb_build_object(
    'total_accounts',  (SELECT count(*) FROM public.accounts),
    'total_users',     (SELECT count(*) FROM public.profiles),
    'active_subs',     (SELECT count(*) FROM live),
    'expiring_7d',     (SELECT count(*) FROM public.subscriptions
                          WHERE status = 'active'
                            AND current_period_end BETWEEN NOW() AND NOW() + INTERVAL '7 days'),
    'expired',         (SELECT count(*) FROM public.subscriptions
                          WHERE status <> 'active'
                             OR (current_period_end IS NOT NULL AND current_period_end <= NOW())),
    'wholesale_subs',  (SELECT count(*) FROM live WHERE public.plan_has_wholesale(plan_type)),
    'trial_subs',      (SELECT count(*) FROM live WHERE plan_type LIKE 'trial%'),
    'paid_subs',       (SELECT count(*) FROM live WHERE plan_type NOT LIKE 'trial%'),
    'annual_subs',     (SELECT count(*) FROM live WHERE plan_type LIKE '%annual'),
    'monthly_subs',    (SELECT count(*) FROM live WHERE plan_type LIKE '%monthly'),
    'no_subscription', (SELECT count(*) FROM public.profiles p
                          WHERE NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = p.id)),
    'mrr',             (SELECT COALESCE(sum(monthly_value), 0) FROM valued),
    'plan_mix',        COALESCE((
                          SELECT jsonb_agg(x ORDER BY x->>'plan_type')
                          FROM (
                            SELECT jsonb_build_object(
                                     'plan_type', plan_type,
                                     'count', count(*),
                                     'monthly_value', sum(monthly_value)
                                   ) AS x
                            FROM valued
                            GROUP BY plan_type
                          ) t
                        ), '[]'::jsonb),
    'new_accounts_30d',(SELECT count(*) FROM public.accounts WHERE created_at > NOW() - INTERVAL '30 days')
  ) INTO result;

  RETURN result;
END;
$$;

-- ─── 3. The wholesale drill-down includes trials too ─────────────────
CREATE OR REPLACE FUNCTION public.admin_segment_subscribers(
  segment     TEXT,
  plan_filter TEXT DEFAULT NULL,
  row_limit   INT  DEFAULT 200
)
RETURNS TABLE (
  user_id              UUID,
  email                TEXT,
  account_id           UUID,
  account_name         TEXT,
  plan_type            TEXT,
  status               TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end   TIMESTAMPTZ,
  signed_up_at         TIMESTAMPTZ,
  razorpay_payment_id  TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_platform_admin();

  RETURN QUERY
  SELECT
    p.id, p.email::TEXT, p.account_id, a.name::TEXT,
    s.plan_type::TEXT, s.status::TEXT,
    s.current_period_start, s.current_period_end,
    p.created_at, s.razorpay_payment_id::TEXT
  FROM public.profiles p
  LEFT JOIN public.accounts a      ON a.id = p.account_id
  LEFT JOIN public.subscriptions s ON s.user_id = p.id
  WHERE
    CASE COALESCE(segment, 'all')
      WHEN 'all' THEN TRUE
      WHEN 'accounts' THEN TRUE

      WHEN 'active' THEN
        s.status = 'active'
        AND (s.current_period_end IS NULL OR s.current_period_end > NOW())

      WHEN 'expiring_7d' THEN
        s.status = 'active'
        AND s.current_period_end BETWEEN NOW() AND NOW() + INTERVAL '7 days'

      WHEN 'expired' THEN
        s.user_id IS NOT NULL
        AND (s.status <> 'active'
             OR (s.current_period_end IS NOT NULL AND s.current_period_end <= NOW()))

      WHEN 'wholesale' THEN
        s.status = 'active'
        AND public.plan_has_wholesale(s.plan_type)
        AND (s.current_period_end IS NULL OR s.current_period_end > NOW())

      WHEN 'trial' THEN
        s.status = 'active' AND s.plan_type LIKE 'trial%'
        AND (s.current_period_end IS NULL OR s.current_period_end > NOW())

      WHEN 'paid' THEN
        s.status = 'active' AND s.plan_type NOT LIKE 'trial%'
        AND (s.current_period_end IS NULL OR s.current_period_end > NOW())

      WHEN 'monthly' THEN
        s.status = 'active' AND s.plan_type LIKE '%monthly'
        AND (s.current_period_end IS NULL OR s.current_period_end > NOW())

      WHEN 'annual' THEN
        s.status = 'active' AND s.plan_type LIKE '%annual'
        AND (s.current_period_end IS NULL OR s.current_period_end > NOW())

      WHEN 'no_subscription' THEN
        s.user_id IS NULL

      WHEN 'new_30d' THEN
        a.created_at > NOW() - INTERVAL '30 days'

      WHEN 'plan' THEN
        s.plan_type = plan_filter AND s.status = 'active'

      ELSE TRUE
    END
  ORDER BY
    CASE WHEN COALESCE(segment,'') IN ('expiring_7d','expired')
         THEN s.current_period_end END ASC NULLS LAST,
    p.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(row_limit, 200), 500));
END;
$$;

-- ─── 4. One call that grants either kind of trial ────────────────────
-- Wraps the plan naming so the frontend never has to build the string.
CREATE OR REPLACE FUNCTION public.admin_grant_trial(
  target_user_id UUID,
  trial_days     INT,
  with_wholesale BOOLEAN DEFAULT FALSE
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_plan TEXT;
BEGIN
  PERFORM public.require_platform_admin();

  IF trial_days IS NULL OR trial_days < 1 OR trial_days > 365 THEN
    RAISE EXCEPTION 'trial_days must be between 1 and 365';
  END IF;

  new_plan := CASE WHEN with_wholesale
                   THEN 'trial_wholesale_' || trial_days || '_days'
                   ELSE 'trial_' || trial_days || '_days' END;

  INSERT INTO public.subscriptions (user_id, plan_type, status, current_period_start, current_period_end)
  VALUES (target_user_id, new_plan, 'active', NOW(), NOW() + (trial_days || ' days')::INTERVAL)
  ON CONFLICT (user_id)
  DO UPDATE SET
    plan_type = EXCLUDED.plan_type,
    status = 'active',
    current_period_end = NOW() + (trial_days || ' days')::INTERVAL,
    updated_at = NOW();

  RETURN new_plan;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_grant_trial(UUID, INT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_trial(UUID, INT, BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_overview_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_overview_stats() TO authenticated;
REVOKE ALL ON FUNCTION public.admin_segment_subscribers(TEXT, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_segment_subscribers(TEXT, TEXT, INT) TO authenticated;
