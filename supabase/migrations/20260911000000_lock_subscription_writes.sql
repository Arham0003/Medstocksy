-- ============================================================
-- Subscriptions may only be written by the payment webhook.
--
-- The client used to upsert this table directly after Razorpay checkout.
-- The original migration never granted INSERT/UPDATE, so RLS rejected it
-- and paying customers were left inactive — and had a permissive policy
-- ever been added (via the dashboard, say) to "fix" that, any signed-in
-- user could have granted themselves a plan from the browser console.
--
-- This migration makes the intent explicit and enforced:
--   * users may READ their own subscription, nothing more
--   * all writes go through razorpay-webhook, which runs with the service
--     role (service role bypasses RLS) only after verifying Razorpay's
--     HMAC signature
--   * grant_admin_trial stays available: it is SECURITY DEFINER and is the
--     sanctioned admin path
-- ============================================================

-- 1) Remove any write policy that exists, whatever it was named.
--    Named policies cannot be dropped blindly, so enumerate them.
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname, cmd
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'subscriptions'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.subscriptions', pol.policyname);
    RAISE NOTICE 'Dropped write policy "%" (%) on subscriptions', pol.policyname, pol.cmd;
  END LOOP;
END $$;

-- 2) Make sure RLS is on and applies to the table owner too, so a
--    privileged-but-not-service-role connection cannot slip past it.
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions FORCE ROW LEVEL SECURITY;

-- 3) Re-assert the read policy (idempotent).
DROP POLICY IF EXISTS "Users can view their own subscription" ON public.subscriptions;
CREATE POLICY "Users can view their own subscription"
  ON public.subscriptions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 4) Belt and braces: even with no policy, do not hand out table-level
--    write privileges to client roles.
REVOKE INSERT, UPDATE, DELETE ON public.subscriptions FROM anon, authenticated;

-- 5) Dedupe guard for webhook retries. Razorpay can deliver the same
--    payment more than once (and both payment.captured and order.paid);
--    the webhook checks for this id before applying, and this index makes
--    that check fast and the intent visible in the schema.
CREATE INDEX IF NOT EXISTS idx_subscriptions_payment
  ON public.subscriptions(razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;

COMMENT ON TABLE public.subscriptions IS
  'Billing state. Read-only to clients; written only by the razorpay-webhook edge function (service role) after HMAC verification, or by grant_admin_trial().';
