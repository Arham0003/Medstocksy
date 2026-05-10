# Fix Sales Return Stock Update Issue

## Problem
When processing a sales return, the product inventory is not being updated correctly. For example:
- Initial stock: 20 pcs
- Sold: 2 pcs (stock becomes 18)
- Return: 1 pc (stock should become 19, but it's not updating)

## Root Cause
The database trigger that updates product stock on sales needs to be verified and potentially recreated to ensure it handles both sales (positive quantities) and returns (negative quantities) correctly.

## Solution

### Option 1: Apply via Supabase Dashboard (Recommended)

1. **Go to Supabase SQL Editor**
   - Navigate to: https://app.supabase.com/project/yuqvtucvqivvvpcfflhq/sql

2. **Run the Fix Script**
   - Copy the contents of `supabase/migrations/apply-stock-return-fix.sql`
   - Paste into the SQL editor
   - Click "Run" to execute

3. **Verify the Fix**
   - The script will show you the trigger details
   - It will also show recent sales and returns with current stock levels

### Option 2: Test Manually

If you want to test if the trigger is working:

```sql
-- 1. Check current stock for a product
SELECT id, name, quantity FROM products WHERE name LIKE '%Dolo%' LIMIT 1;

-- 2. Record the product_id and current quantity

-- 3. Insert a test return (replace YOUR_PRODUCT_ID, YOUR_ACCOUNT_ID, YOUR_USER_ID)
INSERT INTO sales (account_id, product_id, user_id, quantity, unit_price, total_price, gst_amount)
VALUES (
  'YOUR_ACCOUNT_ID',
  'YOUR_PRODUCT_ID',
  'YOUR_USER_ID',
  -1,  -- Negative quantity for return
  10.00,
  -10.00,
  0
);

-- 4. Check stock again - it should have increased by 1
SELECT id, name, quantity FROM products WHERE name LIKE '%Dolo%' LIMIT 1;
```

### Option 3: Verify Trigger Exists

Run this query to check if the trigger is properly set up:

```sql
SELECT 
    t.trigger_name,
    t.event_manipulation,
    t.event_object_table,
    t.action_timing,
    t.action_statement
FROM information_schema.triggers t
WHERE t.trigger_name = 'update_product_stock_trigger'
  AND t.event_object_table = 'sales';
```

Expected result:
- trigger_name: `update_product_stock_trigger`
- event_manipulation: `INSERT`
- event_object_table: `sales`
- action_timing: `AFTER`

## How It Works

The trigger function works as follows:

**For Sales (Positive Quantity):**
```
quantity = quantity - NEW.quantity
Example: 20 - 2 = 18 (stock decreases)
```

**For Returns (Negative Quantity):**
```
quantity = quantity - NEW.quantity
Example: 18 - (-1) = 18 + 1 = 19 (stock increases)
```

## Testing the Fix

After applying the fix:

1. **Check current stock** in Product Management
2. **Process a sale** - verify stock decreases
3. **Process a return** via Sales Return page - verify stock increases
4. **Refresh Product Management** page to see updated quantities

## Troubleshooting

### Stock still not updating?

1. **Check if trigger exists:**
   ```sql
   SELECT * FROM information_schema.triggers 
   WHERE trigger_name = 'update_product_stock_trigger';
   ```

2. **Check recent sales/returns:**
   ```sql
   SELECT id, product_id, quantity, created_at 
   FROM sales 
   ORDER BY created_at DESC 
   LIMIT 10;
   ```

3. **Manually verify a product:**
   ```sql
   SELECT p.name, p.quantity, 
          SUM(CASE WHEN s.quantity > 0 THEN s.quantity ELSE 0 END) as total_sold,
          SUM(CASE WHEN s.quantity < 0 THEN ABS(s.quantity) ELSE 0 END) as total_returned
   FROM products p
   LEFT JOIN sales s ON p.id = s.product_id
   WHERE p.name LIKE '%Dolo%'
   GROUP BY p.id, p.name, p.quantity;
   ```

### Need to recalculate all stock?

If you need to recalculate stock based on sales history:

```sql
-- WARNING: This will recalculate stock based on sales history
-- Make sure you have a backup before running this!

UPDATE products p
SET quantity = (
  SELECT COALESCE(
    -- Start with initial quantity (you may need to adjust this)
    p.quantity + SUM(s.quantity),
    p.quantity
  )
  FROM sales s
  WHERE s.product_id = p.id
);
```

## Support

If the issue persists after applying this fix:
1. Check the Supabase logs for any error messages
2. Verify your database permissions
3. Ensure the trigger is enabled and not disabled
