-- Apply this in Supabase SQL Editor to add store information fields

-- Step 1: Add store information fields to accounts table
ALTER TABLE public.accounts
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS gstin TEXT;

-- Step 2: Add GST type field to settings table
ALTER TABLE public.settings
ADD COLUMN IF NOT EXISTS gst_type TEXT DEFAULT 'exclusive';

-- Step 3: Add constraint to ensure gst_type is either 'inclusive' or 'exclusive'
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'settings_gst_type_check'
    ) THEN
        ALTER TABLE public.settings
        ADD CONSTRAINT settings_gst_type_check 
        CHECK (gst_type IN ('inclusive', 'exclusive'));
    END IF;
END $$;

-- Step 4: Add comments for documentation
COMMENT ON COLUMN public.accounts.address IS 'Store physical address';
COMMENT ON COLUMN public.accounts.phone IS 'Store contact phone number';
COMMENT ON COLUMN public.accounts.gstin IS 'GST Identification Number (GSTIN)';
COMMENT ON COLUMN public.settings.gst_type IS 'GST calculation type: inclusive (price includes GST) or exclusive (GST added to price)';

-- Step 5: Verify the changes
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'accounts' 
AND column_name IN ('address', 'phone', 'gstin')
ORDER BY column_name;

SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'settings' 
AND column_name = 'gst_type';
