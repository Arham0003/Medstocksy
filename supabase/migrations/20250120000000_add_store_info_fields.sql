-- Add store information fields to accounts table
ALTER TABLE public.accounts
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS gstin TEXT;

-- Add GST type field to settings table (inclusive or exclusive)
ALTER TABLE public.settings
ADD COLUMN IF NOT EXISTS gst_type TEXT DEFAULT 'exclusive' CHECK (gst_type IN ('inclusive', 'exclusive'));

-- Add comments for clarity
COMMENT ON COLUMN public.accounts.address IS 'Store physical address';
COMMENT ON COLUMN public.accounts.phone IS 'Store contact phone number';
COMMENT ON COLUMN public.accounts.gstin IS 'GST Identification Number';
COMMENT ON COLUMN public.settings.gst_type IS 'GST calculation type: inclusive (price includes GST) or exclusive (GST added to price)';
