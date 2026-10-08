-- Adds salesman name/phone and customer type to sales rows.
-- All three columns are optional (NULL for pre-migration rows).

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS salesman_name    TEXT,
  ADD COLUMN IF NOT EXISTS salesman_phone   TEXT,
  ADD COLUMN IF NOT EXISTS customer_type    TEXT;   -- e.g. 'Normal', 'Distributor', 'Chemist', 'Hospital'
