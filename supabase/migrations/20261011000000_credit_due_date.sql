-- Credit due dates on sales.
--
-- The credit system deliberately adds no ledger table. A sale already records
-- what was charged (total_price), what came in (received_amount) and whether
-- it is closed (is_settled); the only thing missing was WHEN the money is due,
-- which is what turns a list of unpaid bills into something actionable.
--
-- Additive and nullable, so every existing row and every retail flow is
-- unchanged by construction.

BEGIN;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS credit_due_date DATE;

COMMENT ON COLUMN public.sales.credit_due_date IS
  'When a credit sale falls due. NULL for cash, UPI and card. Set at billing time; the dashboard reads it to surface what is owed in the next seven days.';

-- Guard against an un-dated credit sale, which is the whole point of the
-- feature: a credit bill with no due date can never appear in the alerts.
--
-- NOT VALID is load-bearing. Existing credit rows predate this column and have
-- no due date, so a validating constraint would refuse to be created at all,
-- or would have to be preceded by inventing dates for historical bills. NOT
-- VALID enforces the rule on every INSERT and UPDATE from now on while leaving
-- history exactly as it is - which is also what keeps this migration safe to
-- run on a live database in the middle of a working day.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_credit_needs_due_date'
  ) THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_credit_needs_due_date
      CHECK (payment_mode IS DISTINCT FROM 'credit' OR credit_due_date IS NOT NULL)
      NOT VALID;
  END IF;
END $$;

COMMENT ON CONSTRAINT sales_credit_needs_due_date ON public.sales IS
  'A credit sale must carry a due date. NOT VALID: enforced on new and updated rows only, so pre-existing credit bills are left alone.';

-- The dashboard asks one question on every load: which unsettled credit bills
-- fall due in the next seven days? A partial index keeps that to the rows that
-- can possibly qualify, rather than walking every sale the shop has ever made.
CREATE INDEX IF NOT EXISTS idx_sales_credit_due
  ON public.sales (account_id, credit_due_date)
  WHERE payment_mode = 'credit' AND is_settled = false;

COMMIT;
