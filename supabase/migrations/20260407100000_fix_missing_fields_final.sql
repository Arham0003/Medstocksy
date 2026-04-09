-- Add missing columns to accounts table
ALTER TABLE public.accounts
ADD COLUMN IF NOT EXISTS manager_name TEXT,
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS gstin TEXT;

-- Add missing columns to settings table
ALTER TABLE public.settings
ADD COLUMN IF NOT EXISTS gst_type TEXT DEFAULT 'exclusive' CHECK (gst_type IN ('inclusive', 'exclusive')),
ADD COLUMN IF NOT EXISTS whatsapp_custom_note TEXT;

-- Add missing columns to sales table
ALTER TABLE public.sales
ADD COLUMN IF NOT EXISTS bill_id UUID,
ADD COLUMN IF NOT EXISTS sub_qty INTEGER,
ADD COLUMN IF NOT EXISTS pcs_per_unit INTEGER,
ADD COLUMN IF NOT EXISTS doctor_name TEXT,
ADD COLUMN IF NOT EXISTS sale_date DATE DEFAULT CURRENT_DATE,
ADD COLUMN IF NOT EXISTS prescription_months INTEGER,
ADD COLUMN IF NOT EXISTS months_taken INTEGER,
ADD COLUMN IF NOT EXISTS prescription_notes TEXT,
ADD COLUMN IF NOT EXISTS payment_mode TEXT DEFAULT 'cash',
ADD COLUMN IF NOT EXISTS discount_percentage DECIMAL DEFAULT 0,
ADD COLUMN IF NOT EXISTS customer_address TEXT;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_sales_bill_id ON public.sales(bill_id);
CREATE INDEX IF NOT EXISTS idx_sales_customer_phone_new ON public.sales(customer_phone);
CREATE INDEX IF NOT EXISTS idx_sales_sale_date_new ON public.sales(sale_date);
