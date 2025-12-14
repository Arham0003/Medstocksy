-- Fix stock update trigger to handle both sales and returns
-- This migration ensures the trigger correctly updates inventory for both sales (negative adjustment) and returns (positive adjustment)

-- Drop existing trigger and function
DROP TRIGGER IF EXISTS update_product_stock_trigger ON public.sales;
DROP FUNCTION IF EXISTS public.update_product_stock();

-- Recreate function with better handling for sales and returns
CREATE OR REPLACE FUNCTION public.update_product_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Update product quantity
  -- For sales: NEW.quantity is positive, so we subtract (quantity - NEW.quantity)
  -- For returns: NEW.quantity is negative, so we subtract negative which adds back (quantity - (-1) = quantity + 1)
  UPDATE public.products 
  SET quantity = quantity - NEW.quantity,
      updated_at = NOW()
  WHERE id = NEW.product_id;
  
  -- Check if update was successful
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found';
  END IF;
  
  RETURN NEW;
END;
$$;

-- Recreate trigger
CREATE TRIGGER update_product_stock_trigger
  AFTER INSERT ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.update_product_stock();

-- Add comment for clarity
COMMENT ON FUNCTION public.update_product_stock() IS 'Updates product stock on sale or return. Sales have positive quantity (reduces stock), returns have negative quantity (increases stock).';
