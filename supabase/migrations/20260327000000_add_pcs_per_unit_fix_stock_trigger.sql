-- ============================================================
-- Migration: Add pcs_per_unit to products + fix stock trigger
-- for sub-quantity (loose tablet) sales
-- ============================================================

-- 1. Add pcs_per_unit column to products table
--    This stores how many pieces (tablets) are in one unit (strip).
--    NULL means the product is not sold in sub-quantities.
ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS pcs_per_unit INTEGER DEFAULT NULL;

COMMENT ON COLUMN public.products.pcs_per_unit IS 'Number of pieces (tablets) per unit (strip). NULL means sub-quantity sales not applicable.';

-- 2. Ensure sub_qty and pcs_per_unit columns exist on sales table
ALTER TABLE public.sales
ADD COLUMN IF NOT EXISTS sub_qty INTEGER DEFAULT NULL;

ALTER TABLE public.sales
ADD COLUMN IF NOT EXISTS pcs_per_unit INTEGER DEFAULT NULL;

COMMENT ON COLUMN public.sales.sub_qty IS 'Number of loose pieces (tablets) sold in addition to full units.';
COMMENT ON COLUMN public.sales.pcs_per_unit IS 'Pieces per unit at time of sale, copied from product for historical accuracy.';

-- 3. Fix the stock update trigger to handle sub-quantity
--    New formula: effective_units = quantity + (sub_qty / pcs_per_unit)
--    This correctly subtracts fractional units from inventory
DROP TRIGGER IF EXISTS update_product_stock_trigger ON public.sales;
DROP FUNCTION IF EXISTS public.update_product_stock();

CREATE OR REPLACE FUNCTION public.update_product_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  effective_units NUMERIC;
BEGIN
  -- Calculate effective units to subtract
  -- quantity = full strips, sub_qty = loose tablets, pcs_per_unit = tablets per strip
  -- For sales:  quantity is positive  → stock decreases
  -- For returns: quantity is negative → stock increases (sub_qty is also negative for returns)
  
  IF NEW.sub_qty IS NOT NULL AND NEW.sub_qty != 0 AND NEW.pcs_per_unit IS NOT NULL AND NEW.pcs_per_unit > 0 THEN
    -- Has sub-quantity: total = full_units + (loose_tablets / tablets_per_strip)
    effective_units := NEW.quantity + (NEW.sub_qty::NUMERIC / NEW.pcs_per_unit::NUMERIC);
  ELSE
    -- No sub-quantity: standard full-unit deduction
    effective_units := NEW.quantity;
  END IF;

  -- Update product quantity
  UPDATE public.products
  SET quantity = quantity - effective_units,
      updated_at = NOW()
  WHERE id = NEW.product_id;

  -- Check if update was successful
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found with id: %', NEW.product_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate trigger
CREATE TRIGGER update_product_stock_trigger
  AFTER INSERT ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.update_product_stock();

COMMENT ON FUNCTION public.update_product_stock() IS 'Updates product stock on sale or return. Handles both full units and sub-quantities (loose tablets). Sales reduce stock, returns increase stock.';
