-- Apply this in Supabase SQL Editor to fix stock updates for returns
-- This ensures that when returns are processed, inventory is correctly restored

-- First, let's check the current trigger
SELECT 
    trigger_name, 
    event_manipulation, 
    event_object_table,
    action_statement
FROM information_schema.triggers 
WHERE trigger_name = 'update_product_stock_trigger';

-- Drop and recreate the trigger to ensure it's working correctly
DROP TRIGGER IF EXISTS update_product_stock_trigger ON public.sales;
DROP FUNCTION IF EXISTS public.update_product_stock();

-- Recreate the function with explicit handling
CREATE OR REPLACE FUNCTION public.update_product_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Update product quantity
  -- For sales: NEW.quantity is positive (e.g., 2), so quantity = quantity - 2 (reduces stock)
  -- For returns: NEW.quantity is negative (e.g., -1), so quantity = quantity - (-1) = quantity + 1 (increases stock)
  UPDATE public.products 
  SET quantity = quantity - NEW.quantity,
      updated_at = NOW()
  WHERE id = NEW.product_id;
  
  -- Check if update was successful
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found with id: %', NEW.product_id;
  END IF;
  
  -- Log the update for debugging (optional)
  RAISE NOTICE 'Updated product % stock by % (new quantity adjustment: %)', 
    NEW.product_id, 
    -NEW.quantity,
    NEW.quantity;
  
  RETURN NEW;
END;
$$;

-- Recreate the trigger
CREATE TRIGGER update_product_stock_trigger
  AFTER INSERT ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.update_product_stock();

-- Verify the trigger was created
SELECT 
    trigger_name, 
    event_manipulation, 
    event_object_table,
    action_statement
FROM information_schema.triggers 
WHERE trigger_name = 'update_product_stock_trigger';

-- Test query: Check recent sales and returns
SELECT 
    s.id,
    s.quantity,
    s.created_at,
    p.name as product_name,
    p.quantity as current_stock,
    CASE 
        WHEN s.quantity < 0 THEN 'RETURN'
        ELSE 'SALE'
    END as transaction_type
FROM public.sales s
JOIN public.products p ON s.product_id = p.id
ORDER BY s.created_at DESC
LIMIT 10;
