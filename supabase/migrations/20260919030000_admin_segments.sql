-- ============================================================
-- Migration: drill-down segments for the admin panel
--
-- The Overview cards show counts. This lets the platform owner click any
-- card and see exactly WHICH accounts make up that number, rather than
-- having to search for them by hand.
--
-- One function, one `segment` argument, so a new card needs no new RPC.
-- Returns the same shape as admin_list_subscribers.
-- ============================================================

DROP FUNCTION IF EXISTS public.admin_segment_subscribers(TEXT, TEXT, INT);

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
        AND s.plan_type IN ('wholesale_monthly', 'wholesale_annual')
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
        s.plan_type = plan_filter
        AND s.status = 'active'

      ELSE TRUE
    END
  ORDER BY
    -- Soonest expiry first when the segment is about expiry, newest otherwise.
    CASE WHEN COALESCE(segment,'') IN ('expiring_7d','expired')
         THEN s.current_period_end END ASC NULLS LAST,
    p.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(row_limit, 200), 500));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_segment_subscribers(TEXT, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_segment_subscribers(TEXT, TEXT, INT) TO authenticated;
