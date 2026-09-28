-- ============================================================
-- Migration: richer subscription detail for the admin panel
--
-- Extends admin_list_subscribers with the period start and the Razorpay
-- payment reference, and adds revenue figures to admin_overview_stats, so
-- the panel can show what KIND of subscription each account is on (trial vs
-- paid, monthly vs annual) rather than just the raw plan_type string.
--
-- RETURNS TABLE changes cannot be made with CREATE OR REPLACE, so the
-- function is dropped first. Safe to re-run.
-- ============================================================

DROP FUNCTION IF EXISTS public.admin_list_subscribers(TEXT, INT);

CREATE OR REPLACE FUNCTION public.admin_list_subscribers(
  search_term TEXT DEFAULT NULL,
  row_limit   INT  DEFAULT 50
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
    p.id,
    p.email::TEXT,
    p.account_id,
    a.name::TEXT,
    s.plan_type::TEXT,
    s.status::TEXT,
    s.current_period_start,
    s.current_period_end,
    p.created_at,
    s.razorpay_payment_id::TEXT
  FROM public.profiles p
  LEFT JOIN public.accounts a      ON a.id = p.account_id
  LEFT JOIN public.subscriptions s ON s.user_id = p.id
  WHERE search_term IS NULL
     OR trim(search_term) = ''
     OR p.email ILIKE '%' || trim(search_term) || '%'
     OR a.name  ILIKE '%' || trim(search_term) || '%'
  ORDER BY p.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(row_limit, 50), 200));
END;
$$;

-- Overview gains recurring-revenue figures. Monthly-equivalent value per
-- active plan, matching the prices in Pricing.tsx and create-razorpay-order:
--   professional_monthly 499 | professional_annual 6000/yr  -> 500/mo
--   wholesale_monthly    599 | wholesale_annual    7200/yr  -> 600/mo
--   testing_weekly        50 | trial_*                      -> 0
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
    'wholesale_subs',  (SELECT count(*) FROM live
                          WHERE plan_type IN ('wholesale_monthly','wholesale_annual')),
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

REVOKE ALL ON FUNCTION public.admin_list_subscribers(TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_subscribers(TEXT, INT) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_overview_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_overview_stats() TO authenticated;
