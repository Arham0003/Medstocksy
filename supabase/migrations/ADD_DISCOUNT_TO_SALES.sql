-- Add discount field to sales table
ALTER TABLE public.sales
ADD COLUMN IF NOT EXISTS discount_percentage NUMERIC DEFAULT 0;

COMMENT ON COLUMN public.sales.discount_percentage IS 'Discount percentage applied to the sale item';
