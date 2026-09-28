-- ============================================================
-- Migration: stack repeat purchases instead of losing them
--
-- THE PROBLEM
-- Pricing.tsx wrote the subscription straight from the browser with
-- .upsert({ current_period_end: NOW + 30 days }). Three faults:
--   1. `subscriptions` has RLS on with only a SELECT policy, so the write
--      was refused outright and the customer saw "Payment received but
--      status update failed" after being charged.
--   2. The upsert named no conflict target, so PostgREST aimed at the
--      primary key. With no id supplied it became a plain INSERT and hit
--      UNIQUE (user_id): a second purchase failed with 23505.
--   3. The expiry was computed from NOW, not from the existing expiry, so
--      buying twice would have given 30 days for 60 days of money.
--
-- THE RULE NOW
-- A new purchase starts when the current period ends, so buying a second
-- month while the first is still running queues it: the customer keeps
-- uninterrupted access and the days add up. If nothing is active, or the
-- plan has lapsed, the new period starts today.
--
-- Client code never writes here. The Edge Function verify-razorpay-payment
-- checks the Razorpay signature and calls this with the service role, so a
-- user cannot grant themselves a plan from the browser console.
-- ============================================================

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
