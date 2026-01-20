-- Secure function to grant trial, bypassing RLS
CREATE OR REPLACE FUNCTION public.grant_admin_trial(target_user_id UUID, trial_days INT)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, plan_type, status, current_period_start, current_period_end)
  VALUES (target_user_id, 'trial_' || trial_days || '_days', 'active', NOW(), NOW() + (trial_days || ' days')::INTERVAL)
  ON CONFLICT (user_id)
  DO UPDATE SET
    plan_type = EXCLUDED.plan_type,
    status = 'active',
    current_period_end = NOW() + (trial_days || ' days')::INTERVAL,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
