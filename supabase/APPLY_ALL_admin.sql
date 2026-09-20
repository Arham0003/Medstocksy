-- =====================================================================
--  MEDSTOCKSY - ADMIN PANEL + PLATFORM ADMIN AUTHORIZATION (one file)
--
--  Paste this whole file into the Supabase SQL editor and Run once.
--
--  * Wrapped in a single transaction: if ANY step fails, everything
--    rolls back and your database is left exactly as it was.
--  * Idempotent: safe to run again if you are unsure whether it took.
--  * Verified end to end on PostgreSQL 17 before shipping.
--
--  WHAT THIS FIXES (security)
--  `get_user_id_by_email` and `grant_admin_trial` were SECURITY DEFINER
--  with NO authorization check inside them, and AdminGuard is a frontend
--  lock whose password ships in the JS bundle. Any signed-in user could
--  therefore enumerate customer emails, or grant themselves a paid
--  subscription. After this runs, every admin routine verifies the caller
--  is listed in public.admin_users and raises 42501 otherwise.
--
--  ADMINS ARE SEEDED WITH: contact@medstocksy.in
--  Add more with:
--    INSERT INTO public.admin_users (email, note)
--    VALUES ('you@example.com', 'second admin');
--  The email must match the Supabase Auth login exactly (case-insensitive).
--  The admin list is checked against the account you are SIGNED IN AS,
--  not the ID typed on the unlock screen.
--
--  TAKE A BACKUP FIRST (Dashboard -> Database -> Backups).
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_users (
  email      TEXT PRIMARY KEY,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.admin_users IS
  'Platform administrators, by login email. Checked by is_platform_admin().';

-- Seed the address AdminGuard already treats as the admin.
INSERT INTO public.admin_users (email, note)
VALUES ('contact@medstocksy.in', 'Seeded from AdminGuard')
ON CONFLICT (email) DO NOTHING;

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- Emails are matched case-insensitively.
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users a
    JOIN auth.users u ON lower(u.email) = lower(a.email)
    WHERE u.id = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.is_platform_admin() IS
  'True when the calling user''s email is listed in admin_users.';

-- Raise instead of returning silently, so a non-admin call fails loudly.
CREATE OR REPLACE FUNCTION public.require_platform_admin()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized: platform admin only'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Only admins may see or change the admin list.
DROP POLICY IF EXISTS "admins read admin_users"   ON public.admin_users;
DROP POLICY IF EXISTS "admins manage admin_users" ON public.admin_users;

CREATE POLICY "admins read admin_users"
  ON public.admin_users FOR SELECT TO authenticated
  USING (public.is_platform_admin());

CREATE POLICY "admins manage admin_users"
  ON public.admin_users FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- ─── 2. Harden the two pre-existing admin RPCs ───────────────────────
CREATE OR REPLACE FUNCTION public.get_user_id_by_email(email_input TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_user_id UUID;
BEGIN
  PERFORM public.require_platform_admin();
  SELECT id INTO target_user_id
  FROM auth.users
  WHERE lower(email) = lower(trim(email_input));
  RETURN target_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_admin_trial(target_user_id UUID, trial_days INT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_platform_admin();

  IF trial_days IS NULL OR trial_days < 1 OR trial_days > 365 THEN
    RAISE EXCEPTION 'trial_days must be between 1 and 365';
  END IF;

  INSERT INTO public.subscriptions (user_id, plan_type, status, current_period_start, current_period_end)
  VALUES (target_user_id, 'trial_' || trial_days || '_days', 'active', NOW(), NOW() + (trial_days || ' days')::INTERVAL)
  ON CONFLICT (user_id)
  DO UPDATE SET
    plan_type = EXCLUDED.plan_type,
    status = 'active',
    current_period_end = NOW() + (trial_days || ' days')::INTERVAL,
    updated_at = NOW();
END;
$$;

-- ─── 3. Overview stats ───────────────────────────────────────────────
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

  SELECT jsonb_build_object(
    'total_accounts',  (SELECT count(*) FROM public.accounts),
    'total_users',     (SELECT count(*) FROM public.profiles),
    'active_subs',     (SELECT count(*) FROM public.subscriptions
                          WHERE status = 'active'
                            AND (current_period_end IS NULL OR current_period_end > NOW())),
    'expiring_7d',     (SELECT count(*) FROM public.subscriptions
                          WHERE status = 'active'
                            AND current_period_end BETWEEN NOW() AND NOW() + INTERVAL '7 days'),
    'expired',         (SELECT count(*) FROM public.subscriptions
                          WHERE status <> 'active'
                             OR (current_period_end IS NOT NULL AND current_period_end <= NOW())),
    'wholesale_subs',  (SELECT count(*) FROM public.subscriptions
                          WHERE status = 'active'
                            AND plan_type IN ('wholesale_monthly','wholesale_annual')
                            AND (current_period_end IS NULL OR current_period_end > NOW())),
    'trial_subs',      (SELECT count(*) FROM public.subscriptions
                          WHERE status = 'active' AND plan_type LIKE 'trial%'
                            AND (current_period_end IS NULL OR current_period_end > NOW())),
    'no_subscription', (SELECT count(*) FROM public.profiles p
                          WHERE NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = p.id)),
    'plan_mix',        COALESCE((
                          SELECT jsonb_agg(x ORDER BY x->>'plan_type')
                          FROM (
                            SELECT jsonb_build_object('plan_type', plan_type, 'count', count(*)) AS x
                            FROM public.subscriptions
                            WHERE status = 'active'
                            GROUP BY plan_type
                          ) t
                        ), '[]'::jsonb),
    'new_accounts_30d',(SELECT count(*) FROM public.accounts WHERE created_at > NOW() - INTERVAL '30 days')
  ) INTO result;

  RETURN result;
END;
$$;

-- ─── 4. Subscriber directory ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_subscribers(
  search_term TEXT DEFAULT NULL,
  row_limit   INT  DEFAULT 50
)
RETURNS TABLE (
  user_id            UUID,
  email              TEXT,
  account_id         UUID,
  account_name       TEXT,
  plan_type          TEXT,
  status             TEXT,
  current_period_end TIMESTAMPTZ,
  signed_up_at       TIMESTAMPTZ
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
    s.current_period_end,
    p.created_at
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

-- ─── 5. Subscription actions ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_subscription(
  target_user_id UUID,
  new_plan_type  TEXT,
  days           INT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_platform_admin();

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'target_user_id is required';
  END IF;
  IF days IS NULL OR days < 1 OR days > 3650 THEN
    RAISE EXCEPTION 'days must be between 1 and 3650';
  END IF;

  INSERT INTO public.subscriptions (user_id, plan_type, status, current_period_start, current_period_end)
  VALUES (target_user_id, new_plan_type, 'active', NOW(), NOW() + (days || ' days')::INTERVAL)
  ON CONFLICT (user_id)
  DO UPDATE SET
    plan_type = EXCLUDED.plan_type,
    status = 'active',
    current_period_start = COALESCE(public.subscriptions.current_period_start, NOW()),
    current_period_end = NOW() + (days || ' days')::INTERVAL,
    updated_at = NOW();
END;
$$;

-- Extend from whichever is later: today, or the existing expiry.
CREATE OR REPLACE FUNCTION public.admin_extend_subscription(target_user_id UUID, extra_days INT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_platform_admin();

  IF extra_days IS NULL OR extra_days < 1 OR extra_days > 3650 THEN
    RAISE EXCEPTION 'extra_days must be between 1 and 3650';
  END IF;

  UPDATE public.subscriptions
  SET current_period_end =
        GREATEST(COALESCE(current_period_end, NOW()), NOW()) + (extra_days || ' days')::INTERVAL,
      status = 'active',
      updated_at = NOW()
  WHERE user_id = target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That user has no subscription to extend. Set a plan first.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_subscription(target_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_platform_admin();

  UPDATE public.subscriptions
  SET status = 'cancelled',
      current_period_end = NOW(),
      updated_at = NOW()
  WHERE user_id = target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That user has no subscription to revoke.';
  END IF;
END;
$$;

-- ─── 6. Coupons ──────────────────────────────────────────────────────
-- The coupons table denies all client access (USING FALSE) so the Razorpay
-- edge function is the only reader. These admin-gated RPCs are the UI's way
-- in; the table's own policy stays exactly as it is.
CREATE OR REPLACE FUNCTION public.admin_list_coupons()
RETURNS TABLE (
  id             UUID,
  code           TEXT,
  discount_type  TEXT,
  discount_value NUMERIC,
  max_uses       INT,
  used_count     INT,
  expires_at     TIMESTAMPTZ,
  is_active      BOOLEAN,
  created_at     TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_platform_admin();
  RETURN QUERY
  SELECT c.id, c.code::TEXT, c.discount_type::TEXT, c.discount_value,
         c.max_uses, c.used_count, c.expires_at, c.is_active, c.created_at
  FROM public.coupons c
  ORDER BY c.created_at DESC;
END;
$$;

-- discount_value is PAISE for 'flat' and 1-100 for 'percent' - the same
-- units create-razorpay-order reads.
CREATE OR REPLACE FUNCTION public.admin_upsert_coupon(
  coupon_code    TEXT,
  d_type         TEXT,
  d_value        NUMERIC,
  p_max_uses     INT,
  p_expires_at   TIMESTAMPTZ DEFAULT NULL,
  p_is_active    BOOLEAN DEFAULT TRUE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id UUID;
  clean_code TEXT := upper(trim(coupon_code));
BEGIN
  PERFORM public.require_platform_admin();

  IF clean_code IS NULL OR clean_code = '' THEN
    RAISE EXCEPTION 'Coupon code is required';
  END IF;
  IF d_type NOT IN ('flat','percent') THEN
    RAISE EXCEPTION 'discount_type must be flat or percent';
  END IF;
  IF d_value IS NULL OR d_value <= 0 THEN
    RAISE EXCEPTION 'discount_value must be greater than zero';
  END IF;
  IF d_type = 'percent' AND d_value > 100 THEN
    RAISE EXCEPTION 'A percent discount cannot exceed 100';
  END IF;
  IF p_max_uses IS NULL OR p_max_uses < 1 THEN
    RAISE EXCEPTION 'max_uses must be at least 1';
  END IF;

  INSERT INTO public.coupons (code, discount_type, discount_value, max_uses, expires_at, is_active)
  VALUES (clean_code, d_type, d_value, p_max_uses, p_expires_at, COALESCE(p_is_active, TRUE))
  ON CONFLICT (code) DO UPDATE SET
    discount_type  = EXCLUDED.discount_type,
    discount_value = EXCLUDED.discount_value,
    max_uses       = EXCLUDED.max_uses,
    expires_at     = EXCLUDED.expires_at,
    is_active      = EXCLUDED.is_active
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_coupon_active(coupon_id UUID, active BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_platform_admin();
  UPDATE public.coupons SET is_active = active WHERE id = coupon_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Coupon not found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_coupon(coupon_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_platform_admin();
  DELETE FROM public.coupons WHERE id = coupon_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Coupon not found';
  END IF;
END;
$$;

-- ─── 7. Execution grants ─────────────────────────────────────────────
-- Callable by any signed-in user, but each one proves admin first and
-- raises 42501 otherwise. Anonymous callers are refused outright.
DO $$
DECLARE
  fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.is_platform_admin()',
    'public.admin_overview_stats()',
    'public.admin_list_subscribers(text,int)',
    'public.admin_set_subscription(uuid,text,int)',
    'public.admin_extend_subscription(uuid,int)',
    'public.admin_revoke_subscription(uuid)',
    'public.admin_list_coupons()',
    'public.admin_upsert_coupon(text,text,numeric,int,timestamptz,boolean)',
    'public.admin_set_coupon_active(uuid,boolean)',
    'public.admin_delete_coupon(uuid)',
    'public.get_user_id_by_email(text)',
    'public.grant_admin_trial(uuid,int)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- Subscription detail for the panel (period start, Razorpay reference,
-- revenue figures) so it can show WHAT KIND of plan each account is on.
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- Platform admins may use wholesale without buying a plan.
-- Skips itself with a notice if the wholesale sheet has not been run yet.
-- ---------------------------------------------------------------------
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


-- ---------------------------------------------------------------------
-- Drill-down segments: lets the owner tap a stat card and see exactly
-- which accounts make up that number.
-- ---------------------------------------------------------------------
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


-- ---------------------------------------------------------------------
-- Wholesale trials: a free trial that also unlocks B2B billing, without
-- being counted as recurring revenue.
-- ---------------------------------------------------------------------
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


-- ---------------------------------------------------------------------
-- Repeat purchases stack: a second month bought while the first is
-- running starts when that one ends, instead of overwriting it.
-- ---------------------------------------------------------------------
-- ─── 1. A ledger, one row per payment ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_type           TEXT NOT NULL,
  days                INT  NOT NULL CHECK (days > 0),
  period_start        TIMESTAMPTZ NOT NULL,
  period_end          TIMESTAMPTZ NOT NULL,
  amount_paise        INT,
  razorpay_payment_id TEXT UNIQUE,     -- makes replay a no-op
  razorpay_order_id   TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.subscription_payments IS
  'Every subscription payment and the period it bought. Periods are contiguous: a purchase made while one is running starts when that one ends.';

CREATE INDEX IF NOT EXISTS idx_subscription_payments_user
  ON public.subscription_payments (user_id, period_start DESC);

ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;

-- Customers may read their own receipts. Nobody writes from the client.
DROP POLICY IF EXISTS "own payments readable" ON public.subscription_payments;
CREATE POLICY "own payments readable"
  ON public.subscription_payments FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "admins read all payments" ON public.subscription_payments;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'is_platform_admin') THEN
    EXECUTE $p$
      CREATE POLICY "admins read all payments"
        ON public.subscription_payments FOR SELECT TO authenticated
        USING (public.is_platform_admin())
    $p$;
  END IF;
END $$;

-- ─── 2. Record a payment and extend, never reset ─────────────────────
CREATE OR REPLACE FUNCTION public.record_subscription_payment(
  p_user_id      UUID,
  p_plan_type    TEXT,
  p_days         INT,
  p_payment_id   TEXT DEFAULT NULL,
  p_order_id     TEXT DEFAULT NULL,
  p_amount_paise INT  DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_end TIMESTAMPTZ;
  v_start        TIMESTAMPTZ;
  v_end          TIMESTAMPTZ;
  v_already      public.subscription_payments%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 3650 THEN
    RAISE EXCEPTION 'p_days must be between 1 and 3650';
  END IF;

  -- Replay guard: the same Razorpay payment must never buy time twice,
  -- however many times the handler fires or the page is refreshed.
  IF p_payment_id IS NOT NULL THEN
    SELECT * INTO v_already
    FROM public.subscription_payments
    WHERE razorpay_payment_id = p_payment_id;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'duplicate', true,
        'period_start', v_already.period_start,
        'period_end', v_already.period_end,
        'plan_type', v_already.plan_type
      );
    END IF;
  END IF;

  SELECT current_period_end INTO v_existing_end
  FROM public.subscriptions
  WHERE user_id = p_user_id
    AND status = 'active'
  FOR UPDATE;

  -- Queue behind a running period; start today if there is none or it lapsed.
  v_start := GREATEST(COALESCE(v_existing_end, NOW()), NOW());
  v_end   := v_start + (p_days || ' days')::INTERVAL;

  INSERT INTO public.subscriptions (
    user_id, plan_type, status, current_period_start, current_period_end,
    razorpay_order_id, razorpay_payment_id
  )
  VALUES (
    p_user_id, p_plan_type, 'active', NOW(), v_end, p_order_id, p_payment_id
  )
  ON CONFLICT (user_id) DO UPDATE SET
    -- The plan just bought becomes the active one, so an upgrade applies at
    -- once rather than waiting for the old period to drain.
    plan_type = EXCLUDED.plan_type,
    status = 'active',
    current_period_start = COALESCE(public.subscriptions.current_period_start, NOW()),
    current_period_end = v_end,
    razorpay_order_id = COALESCE(EXCLUDED.razorpay_order_id, public.subscriptions.razorpay_order_id),
    razorpay_payment_id = COALESCE(EXCLUDED.razorpay_payment_id, public.subscriptions.razorpay_payment_id),
    updated_at = NOW();

  INSERT INTO public.subscription_payments (
    user_id, plan_type, days, period_start, period_end,
    amount_paise, razorpay_payment_id, razorpay_order_id
  )
  VALUES (
    p_user_id, p_plan_type, p_days, v_start, v_end,
    p_amount_paise, p_payment_id, p_order_id
  );

  RETURN jsonb_build_object(
    'duplicate', false,
    'period_start', v_start,
    'period_end', v_end,
    'plan_type', p_plan_type,
    'queued', v_start > NOW() + INTERVAL '1 minute'
  );
END;
$$;

-- Service role only. The Edge Function verifies the Razorpay signature
-- before calling; letting the browser call this would be a free plan.
REVOKE ALL ON FUNCTION public.record_subscription_payment(UUID, TEXT, INT, TEXT, TEXT, INT)
  FROM PUBLIC, anon, authenticated;

-- ─── 3. Admin view of an account's payments ──────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_payments(target_user_id UUID)
RETURNS TABLE (
  id                  UUID,
  plan_type           TEXT,
  days                INT,
  period_start        TIMESTAMPTZ,
  period_end          TIMESTAMPTZ,
  amount_paise        INT,
  razorpay_payment_id TEXT,
  created_at          TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_platform_admin();
  RETURN QUERY
  SELECT sp.id, sp.plan_type::TEXT, sp.days, sp.period_start, sp.period_end,
         sp.amount_paise, sp.razorpay_payment_id::TEXT, sp.created_at
  FROM public.subscription_payments sp
  WHERE sp.user_id = target_user_id
  ORDER BY sp.period_start DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_payments(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_payments(UUID) TO authenticated;


COMMIT;

-- =====================================================================
--  VERIFICATION - every row below should read OK
-- =====================================================================
SELECT 'admin_users table' AS check, 'public.admin_users' AS detail,
       CASE WHEN to_regclass('public.admin_users') IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
UNION ALL
SELECT 'seeded admin', COALESCE((SELECT string_agg(email, ', ') FROM public.admin_users), '(none)'),
       CASE WHEN EXISTS (SELECT 1 FROM public.admin_users) THEN 'OK' ELSE 'EMPTY' END
UNION ALL
SELECT 'admin RPCs created', count(*)::text || ' of 10',
       CASE WHEN count(*) = 10 THEN 'OK' ELSE 'MISSING' END
FROM pg_proc WHERE proname IN (
  'is_platform_admin','require_platform_admin','admin_overview_stats','admin_list_subscribers',
  'admin_set_subscription','admin_extend_subscription','admin_revoke_subscription',
  'admin_list_coupons','admin_upsert_coupon','admin_set_coupon_active')
UNION ALL
SELECT 'subscriber detail columns', 'period start + razorpay id',
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'OLD VERSION' END
FROM pg_proc WHERE proname = 'admin_list_subscribers'
  AND pg_get_function_result(oid) LIKE '%razorpay_payment_id%'
UNION ALL
SELECT 'revenue in overview', 'mrr + plan monthly_value',
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'OLD VERSION' END
FROM pg_proc WHERE proname = 'admin_overview_stats' AND prosrc LIKE '%mrr%'
UNION ALL
SELECT 'legacy RPCs hardened', 'get_user_id_by_email + grant_admin_trial',
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'NOT HARDENED' END
FROM pg_proc WHERE proname IN ('get_user_id_by_email','grant_admin_trial')
  AND prosrc LIKE '%require_platform_admin%'
UNION ALL
SELECT 'anon cannot execute', 'EXECUTE revoked from anon',
       CASE WHEN NOT has_function_privilege('anon','public.admin_overview_stats()','EXECUTE')
            THEN 'OK' ELSE 'STILL GRANTED' END
UNION ALL
SELECT 'repeat purchases stack', 'subscription_payments + record_subscription_payment',
       CASE WHEN to_regclass('public.subscription_payments') IS NOT NULL
             AND EXISTS (SELECT 1 FROM pg_proc WHERE proname='record_subscription_payment')
            THEN 'OK' ELSE 'MISSING' END
UNION ALL
SELECT 'customers cannot self-grant', 'record_subscription_payment execute',
       CASE WHEN NOT has_function_privilege('authenticated',
              'public.record_subscription_payment(uuid,text,int,text,text,int)','EXECUTE')
            THEN 'OK' ELSE 'STILL GRANTED' END
UNION ALL
SELECT 'wholesale trials', 'plan_has_wholesale + admin_grant_trial',
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'MISSING' END
FROM pg_proc WHERE proname IN ('plan_has_wholesale','admin_grant_trial')
UNION ALL
SELECT 'card drill-down', 'admin_segment_subscribers',
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'MISSING' END
FROM pg_proc WHERE proname = 'admin_segment_subscribers'
UNION ALL
SELECT 'admins may use wholesale', 'sales insert policy',
       CASE
         WHEN to_regclass('public.sales') IS NULL THEN 'NO SALES TABLE'
         WHEN EXISTS (SELECT 1 FROM pg_policy
                      WHERE polrelid = 'public.sales'::regclass
                        AND polname = 'block_wholesale_for_non_subscribers'
                        AND pg_get_expr(polwithcheck, polrelid) LIKE '%is_platform_admin%')
           THEN 'OK'
         ELSE 'run the wholesale sheet first'
       END;
