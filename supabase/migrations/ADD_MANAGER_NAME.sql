-- Migration to add manager_name to accounts table
-- Run this in the Supabase SQL Editor

ALTER TABLE public.accounts
ADD COLUMN IF NOT EXISTS manager_name TEXT;

-- Add comment for documentation
COMMENT ON COLUMN public.accounts.manager_name IS 'Name of the store manager to be displayed in the UI';

-- Verify the change
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'accounts' 
AND column_name = 'manager_name';
