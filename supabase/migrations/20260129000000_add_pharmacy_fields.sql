-- Add pharmacy/medical store specific fields to products table
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS hsn_code TEXT,
ADD COLUMN IF NOT EXISTS batch_number TEXT,
ADD COLUMN IF NOT EXISTS manufacturer TEXT,
ADD COLUMN IF NOT EXISTS expiry_date TIMESTAMP WITH TIME ZONE;
