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

-- discount_value is PAISE for 'flat' and 1-100 for 'percent' — the same
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
SELECT 'legacy RPCs hardened', 'get_user_id_by_email + grant_admin_trial',
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'NOT HARDENED' END
FROM pg_proc WHERE proname IN ('get_user_id_by_email','grant_admin_trial')
  AND prosrc LIKE '%require_platform_admin%'
UNION ALL
SELECT 'anon cannot execute', 'EXECUTE revoked from anon',
       CASE WHEN NOT has_function_privilege('anon','public.admin_overview_stats()','EXECUTE')
            THEN 'OK' ELSE 'STILL GRANTED' END;
