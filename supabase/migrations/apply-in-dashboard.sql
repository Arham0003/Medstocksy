-- Run this SQL script in your Supabase dashboard to add customer fields to the sales table
-- Go to https://app.supabase.com/project/yuqvtucvqivvvpcfflhq/sql and paste this code

-- Add customer fields to sales table
ALTER TABLE public.sales
ADD COLUMN IF NOT EXISTS customer_name TEXT,
ADD COLUMN IF NOT EXISTS customer_phone TEXT,
ADD COLUMN IF NOT EXISTS customer_email TEXT;

-- Add indexes for better query performance on customer fields
CREATE INDEX IF NOT EXISTS idx_sales_customer_name ON public.sales(customer_name);
CREATE INDEX IF NOT EXISTS idx_sales_customer_phone ON public.sales(customer_phone);
CREATE INDEX IF NOT EXISTS idx_sales_customer_email ON public.sales(customer_email);

-- Verify that the columns were added
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'sales' 
AND column_name IN ('customer_name', 'customer_phone', 'customer_email');