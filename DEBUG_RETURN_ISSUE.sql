-- Debug script to identify why returns aren't updating stock

-- 1. Check if the trigger exists and is enabled
SELECT 
    t.trigger_name,
    t.event_manipulation,
    t.event_object_table,
    t.action_timing,
    t.action_statement,
    t.action_orientation
FROM information_schema.triggers t
WHERE t.trigger_name = 'update_product_stock_trigger';

-- 2. Check the function definition
SELECT 
    p.proname as function_name,
    pg_get_functiondef(p.oid) as function_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname = 'update_product_stock'
  AND n.nspname = 'public';

-- 3. Check recent sales and returns
SELECT 
    s.id,
    s.product_id,
    s.quantity,
    s.total_price,
    s.created_at,
    p.name as product_name,
    p.quantity as current_stock,
    CASE 
        WHEN s.quantity < 0 THEN 'RETURN'
        ELSE 'SALE'
    END as transaction_type
FROM public.sales s
LEFT JOIN public.products p ON s.product_id = p.id
ORDER BY s.created_at DESC
LIMIT 20;

-- 4. Check if there are any returns in the database
SELECT COUNT(*) as return_count
FROM public.sales
WHERE quantity < 0;

-- 5. Find a specific product and its transaction history
-- Replace 'Dolo' with your actual product name
SELECT 
    p.id as product_id,
    p.name,
    p.quantity as current_stock,
    (
        SELECT COUNT(*) 
        FROM sales s 
        WHERE s.product_id = p.id AND s.quantity > 0
    ) as total_sales_count,
    (
        SELECT COALESCE(SUM(s.quantity), 0)
        FROM sales s 
        WHERE s.product_id = p.id AND s.quantity > 0
    ) as total_sold,
    (
        SELECT COUNT(*) 
        FROM sales s 
        WHERE s.product_id = p.id AND s.quantity < 0
    ) as total_returns_count,
    (
        SELECT COALESCE(SUM(ABS(s.quantity)), 0)
        FROM sales s 
        WHERE s.product_id = p.id AND s.quantity < 0
    ) as total_returned
FROM public.products p
WHERE p.name ILIKE '%Dolo%'
LIMIT 5;

-- 6. Check trigger status
SELECT 
    tgname as trigger_name,
    tgenabled as enabled,
    CASE tgenabled
        WHEN 'O' THEN 'Enabled'
        WHEN 'D' THEN 'Disabled'
        WHEN 'R' THEN 'Replica'
        WHEN 'A' THEN 'Always'
        ELSE 'Unknown'
    END as status
FROM pg_trigger
WHERE tgname = 'update_product_stock_trigger';
