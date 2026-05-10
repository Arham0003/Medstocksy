-- Add payment mode field to sales table
ALTER TABLE public.sales
ADD COLUMN IF NOT EXISTS payment_mode TEXT DEFAULT 'cash';

-- Add constraint to ensure valid payment modes
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_payment_mode_check;

ALTER TABLE public.sales
ADD CONSTRAINT sales_payment_mode_check 
CHECK (payment_mode IN ('cash', 'upi', 'card', 'net_banking', 'wallet', 'cheque', 'other'));

-- Add comment for documentation
COMMENT ON COLUMN public.sales.payment_mode IS 'Payment method used: cash, upi, card, net_banking, wallet, cheque, or other';

-- Verify the change
SELECT column_name, data_type, column_default
FROM information_schema.columns 
WHERE table_name = 'sales' 
AND column_name = 'payment_mode';
