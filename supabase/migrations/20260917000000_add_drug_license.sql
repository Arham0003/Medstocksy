-- Add drug_license column to accounts table
-- Stores the pharmacy's Drug License number, printed on every bill.
alter table public.accounts
  add column if not exists drug_license text;
