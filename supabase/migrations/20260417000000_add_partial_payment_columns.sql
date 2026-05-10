-- Migration to add partial payment and settlement tracking to sales
ALTER TABLE public.sales
ADD COLUMN IF NOT EXISTS received_amount DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_settled BOOLEAN DEFAULT false;

-- Update existing records: if payment_mode is not 'credit', assume fully paid
UPDATE public.sales
SET received_amount = total_price,
    is_settled = true
WHERE payment_mode != 'credit' AND received_amount = 0;

-- For existing 'credit' sales, assume nothing paid yet
UPDATE public.sales
SET received_amount = 0,
    is_settled = false
WHERE payment_mode = 'credit' AND received_amount = 0;
