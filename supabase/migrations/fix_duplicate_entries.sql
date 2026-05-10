-- MIGRATION TO PREVENT DUPLICATE ENTRIES AND CLEAN UP EXISTING ONES

-- 1. CLEAN UP DUPLICATE PRODUCTS
-- Identify products with same account_id, name, and batch_number created within 1 minute of each other
DELETE FROM public.products p1
USING public.products p2
WHERE p1.id > p2.id
  AND p1.account_id = p2.account_id
  AND p1.name = p2.name
  AND (p1.batch_number IS NOT DISTINCT FROM p2.batch_number)
  AND (p1.manufacturer IS NOT DISTINCT FROM p2.manufacturer)
  AND ABS(EXTRACT(EPOCH FROM (p1.created_at - p2.created_at))) < 60;

-- 2. CLEAN UP DUPLICATE SALES (RETURNS)
-- Identify returns (negative quantity) with same properties created within 1 minute
DELETE FROM public.sales s1
USING public.sales s2
WHERE s1.id > s2.id
  AND s1.account_id = s2.account_id
  AND s1.product_id = s2.product_id
  AND s1.quantity = s2.quantity
  AND s1.total_price = s2.total_price
  AND s1.quantity < 0
  AND (s1.customer_name IS NOT DISTINCT FROM s2.customer_name)
  AND ABS(EXTRACT(EPOCH FROM (s1.created_at - s2.created_at))) < 60;

-- 3. ADD PREVENTIVE SAFETY FOR PRODUCTS
-- Use a unique constraint to prevent identical products for the same account
-- Note: This might fail if you have legitimate products with same name/batch but different prices.
-- However, for the same account, same name and batch usually should be unique.
ALTER TABLE public.products ADD CONSTRAINT unique_account_product_batch UNIQUE (account_id, name, batch_number, manufacturer);

-- 4. ADD PREVENTIVE SAFETY FOR SALES (RETURNS)
-- We use a trigger that prevents inserting a duplicate return within a very short window (e.g. 5 seconds)
CREATE OR REPLACE FUNCTION public.check_duplicate_sales()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Only guard returns or extremely rapid duplicate sales
    IF EXISTS (
        SELECT 1 FROM public.sales
        WHERE account_id = NEW.account_id
          AND product_id = NEW.product_id
          AND quantity = NEW.quantity
          AND total_price = NEW.total_price
          AND (customer_name IS NOT DISTINCT FROM NEW.customer_name)
          AND created_at > NOW() - INTERVAL '5 seconds'
    ) THEN
        -- Simply return NULL to ignore the insert, or RAISE EXCEPTION to notify the user
        -- Using RAISE EXCEPTION is better as it stops the code execution and prevents double UI updates
        RAISE EXCEPTION 'Duplicate entry detected. Entry already recorded.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_duplicate_sales_trigger ON public.sales;
CREATE TRIGGER prevent_duplicate_sales_trigger
BEFORE INSERT ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.check_duplicate_sales();
