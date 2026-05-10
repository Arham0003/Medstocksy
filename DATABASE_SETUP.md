# Database Setup and Migration

This document explains how to set up the database and apply the required migrations for the Local Stock application.

## Prerequisites

1. Node.js (version 14 or higher) - Only needed for local database setup
2. Access to the Supabase project (project ID: yuqvtucvqivvvpcfflhq)

## Applying the Customer Fields Migration

The Local Stock application requires a database migration to add customer information fields to the sales table. You can apply this migration in one of three ways:

### Option 1: Using the Supabase Dashboard (Recommended for Production)

1. Go to [Supabase Dashboard](https://app.supabase.com/project/yuqvtucvqivvvpcfflhq/sql)
2. Create a new query
3. Copy and paste the contents of `supabase/migrations/apply-in-dashboard.sql`:
   ```sql
   -- Add customer fields to sales table
   ALTER TABLE public.sales
   ADD COLUMN IF NOT EXISTS customer_name TEXT,
   ADD COLUMN IF NOT EXISTS customer_phone TEXT,
   ADD COLUMN IF NOT EXISTS customer_email TEXT;
   
   -- Add indexes for better query performance on customer fields
   CREATE INDEX IF NOT EXISTS idx_sales_customer_name ON public.sales(customer_name);
   CREATE INDEX IF NOT EXISTS idx_sales_customer_phone ON public.sales(customer_phone);
   CREATE INDEX IF NOT EXISTS idx_sales_customer_email ON public.sales(customer_email);
   ```
4. Click "Run" to execute the query
5. Verify the columns were added by running:
   ```sql
   SELECT column_name, data_type 
   FROM information_schema.columns 
   WHERE table_name = 'sales' 
   AND column_name IN ('customer_name', 'customer_phone', 'customer_email');
   ```

### Option 2: Using the Supabase CLI (For Development)

1. Install the Supabase CLI:
   ```bash
   npm install -g supabase
   ```

2. Log in to your Supabase account:
   ```bash
   supabase login
   ```

3. Link your project:
   ```bash
   supabase link --project-ref yuqvtucvqivvvpcfflhq
   ```

4. Apply the migrations:
   ```bash
   supabase migration up
   ```

### Option 3: Manual Database Connection (For Local Development)

If you're using a local database or a different deployment method, you can apply the migrations manually:

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set database connection details in a `.env` file:
   ```env
   DB_HOST=your-database-host
   DB_PORT=5432
   DB_NAME=your-database-name
   DB_USER=your-database-username
   DB_PASSWORD=your-database-password
   ```

3. Run the migration script:
   ```bash
   npm run apply-migration
   ```

## Verifying the Migration

After applying the migration, restart your application and try recording a sale again. The error should be resolved, and you should be able to see customer information in the sales records.

## Troubleshooting

### Common Issues

1. **"Could not find the customer name column"**: This means the migration hasn't been applied yet. Follow the steps above to apply the migration.

2. **Permission errors**: Ensure your database user has ALTER permissions on the sales table.

3. **Connection issues**: Verify your database connection settings are correct.

### Checking Current Schema

You can verify that the migration was applied by running this query in your Supabase SQL editor:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'sales' 
AND column_name IN ('customer_name', 'customer_phone', 'customer_email');
```

If the migration was successful, you should see three rows returned with the customer column information.