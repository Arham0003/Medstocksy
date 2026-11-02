-- Fix: admin_grant_trial now also sets settings.wholesale_mode = true
-- when with_wholesale is true, so the feature is immediately active
-- without the user needing to flip the Settings toggle manually.
--
-- Root cause: the original function wrote the subscription plan but never
-- touched settings.wholesale_mode, so isActive in useWholesaleAccess
-- stayed false (hasPlan=true but wholesale_mode=false/null) and all
-- wholesale screens remained locked.

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
  new_plan   TEXT;
  v_account  UUID;
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
    plan_type            = EXCLUDED.plan_type,
    status               = 'active',
    current_period_end   = NOW() + (trial_days || ' days')::INTERVAL,
    updated_at           = NOW();

  -- When granting a wholesale trial, auto-enable the settings toggle so the
  -- user lands in wholesale mode immediately (mirrors what a paying subscriber
  -- gets after they flip it on in Settings).
  IF with_wholesale THEN
    SELECT account_id INTO v_account
      FROM public.profiles WHERE id = target_user_id LIMIT 1;

    IF v_account IS NOT NULL THEN
      UPDATE public.settings
        SET wholesale_mode = TRUE
        WHERE account_id = v_account;
    END IF;
  END IF;

  RETURN new_plan;
END;
$$;

-- Permissions unchanged - authenticated role covers the admin check above.
REVOKE ALL ON FUNCTION public.admin_grant_trial(UUID, INT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_trial(UUID, INT, BOOLEAN) TO authenticated;
