-- Duplicate sales: a deterministic guard, replacing a time-window guess.
--
-- THE PROBLEM
--   handleSave minted a fresh bill_id on every call and guarded re-entry with
--   React state. State does not update until the next render, so two clicks
--   dispatched inside one task both read "not saving" and both ran: two bill
--   ids, two sets of rows, stock deducted twice, two invoice serials burned.
--   Nothing in the database could tell those two bills apart, because by the
--   time they arrived they genuinely were two different bills.
--
-- THE FIX
--   The client now mints the bill id once per bill and tags every line with a
--   stable client_line_id. A resubmission therefore arrives carrying exactly
--   the identifiers the database already holds, and a unique index can refuse
--   it. The client treats that refusal as success, because it is: the sale is
--   recorded, once.
--
--   This is an identity check, not a similarity check. Two walk-in customers
--   buying the same strip of paracetamol a second apart are two sales and both
--   are accepted; the same sale arriving twice is one sale and the second copy
--   is rejected.

BEGIN;

-- ─── 1. Line identity ──────────────────────────────────────────────────────
-- Text rather than uuid: the free-goods line of a wholesale bill is derived
-- from its priced line's id with a suffix, so one grid row can produce two
-- distinct database rows without a second identifier to carry around.
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS client_line_id text;

COMMENT ON COLUMN public.sales.client_line_id IS
  'Stable client-generated identity for this bill line. Lets the database '
  'refuse a resubmitted bill. NULL on rows written before this migration and '
  'by any client that does not send it, which the unique index below ignores.';

-- ─── 2. The guard ──────────────────────────────────────────────────────────
-- Partial, so the history - every row of which has NULL here - is left alone
-- and keeps working. Scoped to the account so one tenant can never collide
-- with another's line ids.
CREATE UNIQUE INDEX IF NOT EXISTS sales_client_line_unique
  ON public.sales (account_id, client_line_id)
  WHERE client_line_id IS NOT NULL;

-- ─── 3. Remove the heuristic this replaces ─────────────────────────────────
-- supabase/migrations/fix_duplicate_entries.sql installed a BEFORE INSERT
-- trigger that rejected any sale matching another on account, product,
-- quantity, total and customer name within five seconds.
--
-- It rejects legitimate sales. Two walk-in customers buying the same item in
-- the same minute are indistinguishable to it, and both are recorded under
-- "Walk-in Customer", so the second one is refused - and because it RAISEs,
-- it takes the whole multi-row bill down with it, not just the line it
-- objected to. It also cannot catch a genuine duplicate that arrives six
-- seconds late.
--
-- Dropped only if present; this is a no-op on a database that never ran it.
DROP TRIGGER IF EXISTS prevent_duplicate_sales_trigger ON public.sales;
DROP FUNCTION IF EXISTS public.check_duplicate_sales();

COMMIT;

-- ─── Verification ──────────────────────────────────────────────────────────
DO $$
DECLARE has_col boolean; has_idx boolean; has_trg boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='sales'
                    AND column_name='client_line_id') INTO has_col;
  SELECT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND tablename='sales'
                    AND indexname='sales_client_line_unique') INTO has_idx;
  SELECT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname='prevent_duplicate_sales_trigger') INTO has_trg;

  RAISE NOTICE '%  client_line_id column', CASE WHEN has_col THEN 'OK  ' ELSE 'FAIL' END;
  RAISE NOTICE '%  sales_client_line_unique index', CASE WHEN has_idx THEN 'OK  ' ELSE 'FAIL' END;
  RAISE NOTICE '%  five-second heuristic trigger removed', CASE WHEN NOT has_trg THEN 'OK  ' ELSE 'FAIL' END;
END $$;
