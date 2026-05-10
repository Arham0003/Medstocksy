-- Add customer fields to sales table
-- This migration adds customer information columns to the sales table
-- To apply this migration, run: npx supabase migration up
-- Or apply it manually to your database
ALTER TABLE public.sales
ADD COLUMN IF NOT EXISTS customer_name TEXT,
ADD COLUMN IF NOT EXISTS customer_phone TEXT,
ADD COLUMN IF NOT EXISTS customer_email TEXT;

-- Update RLS policy for sales insert to include new columns
DROP POLICY IF EXISTS "Users can create sales in their account" ON public.sales;

CREATE POLICY "Users can create sales in their account"
ON public.sales FOR INSERT
TO authenticated
WITH CHECK (
  account_id = public.get_user_account_id() 
  AND product_id IS NOT NULL 
  AND quantity > 0 
  AND unit_price IS NOT NULL
);

-- Add indexes for better query performance on customer fields
CREATE INDEX IF NOT EXISTS idx_sales_customer_name ON public.sales(customer_name);
CREATE INDEX IF NOT EXISTS idx_sales_customer_phone ON public.sales(customer_phone);
CREATE INDEX IF NOT EXISTS idx_sales_customer_email ON public.sales(customer_email);