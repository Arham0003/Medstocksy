-- Granting a plan from Admin Control: make it work, and stop it destroying
-- time the customer has already paid for.
--
-- TWO PROBLEMS
--
-- 1. It took paid days away. admin_set_subscription set
--    current_period_end = NOW() + days unconditionally, so applying a
--    30-day plan to an annual customer with 300 days left ended their
--    access 270 days early. Measured on a test database before this change:
--      "paid until 2027-08-29 -> now ends 2026-12-02 (270 days lost)"
--
-- 2. It could not be called at all on a database where the function is
--    missing or where PostgREST is still holding an older schema cache -
--    the call comes back "Could not find the function ... in the schema
--    cache" while admin_grant_trial, added by a later migration, works
--    fine. That is the difference between the Accounts section failing and
--    the Trial section succeeding.
--
-- THE RULE NOW
--   The plan changes immediately. The expiry moves to whichever is LATER:
--   what the customer already holds, or the number of days being granted.
--   An admin can always shorten deliberately with Revoke access; nobody can
--   shorten by accident with Apply plan.

BEGIN;

-- RETURNS changes from VOID to TEXT, so the function has to go first.
-- Dropping and recreating keeps the signature the client already calls.
DROP FUNCTION IF EXISTS public.admin_set_subscription(UUID, TEXT, INT);

CREATE FUNCTION public.admin_set_subscription(
  target_user_id UUID,
  new_plan_type  TEXT,
  days           INT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  granted_end  TIMESTAMPTZ;
  existing_end TIMESTAMPTZ;
  final_end    TIMESTAMPTZ;
BEGIN
  PERFORM public.require_platform_admin();

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'target_user_id is required';
  END IF;
  IF new_plan_type IS NULL OR btrim(new_plan_type) = '' THEN
    RAISE EXCEPTION 'new_plan_type is required';
  END IF;
  IF days IS NULL OR days < 1 OR days > 3650 THEN
    RAISE EXCEPTION 'days must be between 1 and 3650';
  END IF;

  granted_end := NOW() + (days || ' days')::INTERVAL;

  SELECT current_period_end INTO existing_end
    FROM public.subscriptions
   WHERE user_id = target_user_id;

  -- Never shorten. A lapsed or missing period counts for nothing, so a
  -- customer whose plan ran out simply gets the new period from today.
  final_end := GREATEST(granted_end, COALESCE(existing_end, granted_end));

  INSERT INTO public.subscriptions (user_id, plan_type, status, current_period_start, current_period_end)
  VALUES (target_user_id, new_plan_type, 'active', NOW(), final_end)
  ON CONFLICT (user_id)
  DO UPDATE SET
    plan_type = EXCLUDED.plan_type,
    status = 'active',
    current_period_start = COALESCE(public.subscriptions.current_period_start, NOW()),
    current_period_end = EXCLUDED.current_period_end,
    updated_at = NOW();

  RETURN new_plan_type || ' until ' || to_char(final_end, 'DD Mon YYYY');
END;
$$;

COMMENT ON FUNCTION public.admin_set_subscription(UUID, TEXT, INT) IS
  'Sets an account plan from Admin Control. The expiry moves to whichever is '
  'later - the time already paid for, or the days being granted - so applying '
  'a plan can never take away days a customer has bought.';

REVOKE ALL ON FUNCTION public.admin_set_subscription(UUID, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_subscription(UUID, TEXT, INT) TO authenticated;

COMMIT;

-- PostgREST keeps a cache of what functions exist. A function it has never
-- seen comes back as "Could not find the function ... in the schema cache"
-- however correct the SQL is, which is what makes this look like a bug in
-- the panel. This asks it to look again.
NOTIFY pgrst, 'reload schema';

-- ─── Verification ──────────────────────────────────────────────────────────
DO $$
DECLARE has_fn boolean; can_exec boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'admin_set_subscription'
       AND pg_get_function_identity_arguments(p.oid) = 'target_user_id uuid, new_plan_type text, days integer'
  ) INTO has_fn;

  SELECT has_function_privilege('authenticated',
    'public.admin_set_subscription(uuid,text,integer)', 'EXECUTE') INTO can_exec;

  RAISE NOTICE '%  admin_set_subscription(uuid,text,int) exists', CASE WHEN has_fn THEN 'OK  ' ELSE 'FAIL' END;
  RAISE NOTICE '%  authenticated may execute it', CASE WHEN can_exec THEN 'OK  ' ELSE 'FAIL' END;
END $$;
