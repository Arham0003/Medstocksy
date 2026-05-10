-- Apply this in Supabase SQL Editor to add payment mode field

-- Add payment mode column
ALTER TABLE public.sales
ADD COLUMN IF NOT EXISTS payment_mode TEXT DEFAULT 'cash';

-- Drop existing constraint if any
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_payment_mode_check;

-- Add constraint for valid payment modes
ALTER TABLE public.sales
ADD CONSTRAINT sales_payment_mode_check 
CHECK (payment_mode IN ('cash', 'upi', 'card', 'net_banking', 'wallet', 'cheque', 'other'));

-- Verify the change
SELECT column_name, data_type, column_default
FROM information_schema.columns 
WHERE table_name = 'sales' 
AND column_name = 'payment_mode';
