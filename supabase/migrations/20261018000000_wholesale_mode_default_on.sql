-- Wholesale was unreachable for everyone who paid for it.
--
-- settings.wholesale_mode arrived with 20260918000000 as
-- NOT NULL DEFAULT FALSE, and the client required it before showing the
-- wholesale screens:
--
--     isActive = active wholesale subscription AND settings.wholesale_mode
--
-- Nothing in the application ever wrote that column. There was no toggle in
-- Settings, no admin control, nothing. So it was false for every account that
-- had not edited the row by hand, which meant every paying subscriber was
-- redirected to /pricing - a page selling them what they had already bought.
--
-- The database never agreed with that. The RESTRICTIVE policy on sales
-- (20260919040000) asks only for an active wholesale plan, which is the real
-- entitlement. wholesale_mode is a display preference on top of it.
--
-- This migration makes the column mean what the client now reads it as:
-- on unless the account deliberately turns it off.

BEGIN;

-- The backfill below must happen exactly once, and the column's own default
-- is the marker: it is FALSE until this migration changes it. Running the
-- file a second time - pasting it into the SQL editor again, say - therefore
-- skips the backfill and leaves every deliberate opt-out alone. Without this
-- guard, a re-run would switch wholesale back on for an account that had
-- turned it off, which is the one thing a repeat must not do.
DO $$
DECLARE already_applied boolean;
BEGIN
  SELECT column_default ILIKE '%true%' INTO already_applied
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'settings'
     AND column_name = 'wholesale_mode';

  -- Recorded for the verification block below, which only insists on zero
  -- switched-off subscribers when the backfill is the one that just ran.
  PERFORM set_config('medstocksy.wm_backfill_ran', CASE WHEN already_applied THEN 'no' ELSE 'yes' END, false);

  IF already_applied THEN
    RAISE NOTICE 'wholesale_mode backfill already applied; leaving preferences alone';
    RETURN;
  END IF;

  -- Existing accounts entitled to wholesale: switch on the ones that were
  -- switched off only because nothing could ever switch them on.
  --
  -- Scoped to accounts that actually hold the plan, so a retail-only pharmacy
  -- is left exactly as it is and does not suddenly grow B2B screens.
  UPDATE public.settings s
     SET wholesale_mode = TRUE
   WHERE s.wholesale_mode = FALSE
     AND EXISTS (
       SELECT 1
         FROM public.profiles p
         JOIN public.subscriptions sub ON sub.user_id = p.id
        WHERE p.account_id = s.account_id
          AND sub.status = 'active'
          AND public.plan_has_wholesale(sub.plan_type)
     );
END $$;

-- New accounts: visible by default, so buying the plan is enough. Set AFTER
-- the backfill, because it is what marks the backfill as done.
ALTER TABLE public.settings
  ALTER COLUMN wholesale_mode SET DEFAULT TRUE;

-- ─── Keep it true for everyone who buys wholesale from here on ────────────
-- The backfill above is a one-time correction. Without this, an account whose
-- settings row already exists - every account that has ever opened Settings -
-- would buy a wholesale plan tomorrow and still find the screens hidden,
-- because its stored value is false and the new default only applies to rows
-- created after this migration. That is the original bug, just postponed.
--
-- Fires only when a subscription BECOMES an active wholesale plan. A renewal
-- of a plan that was already active and already wholesale changes nothing, so
-- an account that deliberately switched wholesale off keeps it off.
CREATE OR REPLACE FUNCTION public.sync_wholesale_mode_on_subscription()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  was_wholesale boolean := FALSE;
  is_wholesale  boolean;
BEGIN
  is_wholesale := NEW.status = 'active' AND public.plan_has_wholesale(NEW.plan_type);

  IF TG_OP = 'UPDATE' THEN
    was_wholesale := OLD.status = 'active' AND public.plan_has_wholesale(OLD.plan_type);
  END IF;

  IF is_wholesale AND NOT was_wholesale THEN
    UPDATE public.settings s
       SET wholesale_mode = TRUE
      FROM public.profiles p
     WHERE p.id = NEW.user_id
       AND s.account_id = p.account_id
       AND s.wholesale_mode = FALSE;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sync_wholesale_mode ON public.subscriptions;
CREATE TRIGGER sync_wholesale_mode
  AFTER INSERT OR UPDATE OF plan_type, status ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_wholesale_mode_on_subscription();

COMMENT ON FUNCTION public.sync_wholesale_mode_on_subscription() IS
  'Switches an account''s wholesale screens on when it takes an active '
  'wholesale plan. Does not fire on a renewal, so a deliberate opt-out stands.';

COMMENT ON COLUMN public.settings.wholesale_mode IS
  'Shows the wholesale screens and B2B fields. Defaults TRUE: the subscription '
  'grants the feature (see the RESTRICTIVE policy on sales), this only decides '
  'whether it is on show. Turn off for a retail-only account.';

COMMIT;

-- ─── Verification ──────────────────────────────────────────────────────────
DO $$
DECLARE dflt text; still_off int;
BEGIN
  SELECT column_default INTO dflt
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'settings'
     AND column_name = 'wholesale_mode';

  SELECT count(*) INTO still_off
    FROM public.settings s
   WHERE s.wholesale_mode = FALSE
     AND EXISTS (
       SELECT 1 FROM public.profiles p
         JOIN public.subscriptions sub ON sub.user_id = p.id
        WHERE p.account_id = s.account_id
          AND sub.status = 'active'
          AND public.plan_has_wholesale(sub.plan_type));

  RAISE NOTICE '%  wholesale_mode now defaults to true (is: %)',
    CASE WHEN dflt ILIKE '%true%' THEN 'OK  ' ELSE 'FAIL' END, COALESCE(dflt, 'null');
  RAISE NOTICE '%  new wholesale purchases switch it on',
    CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'sync_wholesale_mode')
         THEN 'OK  ' ELSE 'FAIL' END;
  IF current_setting('medstocksy.wm_backfill_ran', true) = 'yes' THEN
    RAISE NOTICE '%  subscribers still switched off: %',
      CASE WHEN still_off = 0 THEN 'OK  ' ELSE 'FAIL' END, still_off;
  ELSE
    -- A repeat run. Anyone switched off here chose to be, which is the point
    -- of the guard above, so it is reported rather than judged.
    RAISE NOTICE 'OK    backfill already done; % subscriber(s) switched off by choice', still_off;
  END IF;
END $$;
