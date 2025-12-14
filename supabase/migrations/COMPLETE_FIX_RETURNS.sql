-- COMPLETE FIX FOR SALES RETURNS STOCK UPDATE
-- Run this entire script in Supabase SQL Editor

-- Step 1: Drop existing trigger and function
DROP TRIGGER IF EXISTS update_product_stock_trigger ON public.sales;
DROP FUNCTION IF EXISTS public.update_product_stock();

-- Step 2: Create improved function with SECURITY DEFINER to bypass RLS
CREATE OR REPLACE FUNCTION public.update_product_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER  -- This is crucial - it runs with the function owner's privileges
SET search_path = public
AS $$
DECLARE
    v_old_quantity INTEGER;
    v_new_quantity INTEGER;
    v_product_name TEXT;
BEGIN
    -- Get current product quantity for logging
    SELECT quantity, name INTO v_old_quantity, v_product_name
    FROM public.products
    WHERE id = NEW.product_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found with id: %', NEW.product_id;
    END IF;
    
    -- Update product quantity
    -- For sales: NEW.quantity is positive (e.g., 2), so quantity = quantity - 2 (reduces stock)
    -- For returns: NEW.quantity is negative (e.g., -1), so quantity = quantity - (-1) = quantity + 1 (increases stock)
    UPDATE public.products 
    SET quantity = quantity - NEW.quantity,
        updated_at = NOW()
    WHERE id = NEW.product_id
    RETURNING quantity INTO v_new_quantity;
    
    -- Log the change for debugging
    RAISE NOTICE 'Stock updated for product "%" (ID: %): % -> % (adjustment: %)', 
        v_product_name,
        NEW.product_id, 
        v_old_quantity,
        v_new_quantity,
        -NEW.quantity;
    
    RETURN NEW;
END;
$$;

-- Step 3: Create the trigger
CREATE TRIGGER update_product_stock_trigger
    AFTER INSERT ON public.sales
    FOR EACH ROW
    EXECUTE FUNCTION public.update_product_stock();

-- Step 4: Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.update_product_stock() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_product_stock() TO service_role;

-- Step 5: Verify the trigger was created
SELECT 
    t.trigger_name,
    t.event_manipulation,
    t.event_object_table,
    t.action_timing,
    CASE 
        WHEN tg.tgenabled = 'O' THEN 'ENABLED'
        WHEN tg.tgenabled = 'D' THEN 'DISABLED'
        ELSE 'UNKNOWN'
    END as trigger_status
FROM information_schema.triggers t
JOIN pg_trigger tg ON tg.tgname = t.trigger_name
WHERE t.trigger_name = 'update_product_stock_trigger';

-- Step 6: Test the trigger with a sample return (OPTIONAL - comment out if not needed)
-- Uncomment the lines below to test, but replace the IDs with actual values from your database

/*
-- First, get a product ID and current stock
SELECT id, name, quantity FROM products LIMIT 1;

-- Then insert a test return (replace the IDs below)
DO $$
DECLARE
    v_test_product_id UUID;
    v_test_account_id UUID;
    v_test_user_id UUID;
    v_old_qty INTEGER;
    v_new_qty INTEGER;
BEGIN
    -- Get first product
    SELECT id INTO v_test_product_id FROM products LIMIT 1;
    SELECT account_id INTO v_test_account_id FROM products LIMIT 1;
    SELECT id INTO v_test_user_id FROM profiles LIMIT 1;
    
    -- Get current quantity
    SELECT quantity INTO v_old_qty FROM products WHERE id = v_test_product_id;
    
    RAISE NOTICE 'Testing return for product %. Current stock: %', v_test_product_id, v_old_qty;
    
    -- Insert test return
    INSERT INTO sales (account_id, product_id, user_id, quantity, unit_price, total_price, gst_amount)
    VALUES (v_test_account_id, v_test_product_id, v_test_user_id, -1, 10.00, -10.00, 0);
    
    -- Check new quantity
    SELECT quantity INTO v_new_qty FROM products WHERE id = v_test_product_id;
    
    RAISE NOTICE 'After return: Stock changed from % to %', v_old_qty, v_new_qty;
    
    -- Rollback the test
    RAISE EXCEPTION 'Test complete - rolling back test data';
END $$;
*/

-- Step 7: Show recent transactions to verify
SELECT 
    s.id,
    s.quantity,
    s.created_at,
    p.name as product_name,
    p.quantity as current_stock,
    CASE 
        WHEN s.quantity < 0 THEN 'RETURN'
        ELSE 'SALE'
    END as type
FROM sales s
JOIN products p ON s.product_id = p.id
ORDER BY s.created_at DESC
LIMIT 10;
