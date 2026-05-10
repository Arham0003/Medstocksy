# Database Migrations

This directory contains database migration scripts for the Local Stock application.

## Applying Migrations

To apply the migrations to your database, you have several options:

### Option 1: Using Supabase CLI (Recommended)

1. Make sure you have the Supabase CLI installed:
   ```
   npm install -g supabase
   ```

2. Link your project:
   ```
   supabase link --project-ref your-project-ref
   ```

3. Apply the migrations:
   ```
   supabase migration up
   ```

### Option 2: Manual Application

If you're using a local database or a different deployment method, you can apply the migrations manually:

1. Connect to your database using a database client (psql, pgAdmin, etc.)

2. Run the SQL commands from the migration files in chronological order (based on filename)

3. For the customer fields migration (20250925100000_add_customer_fields_to_sales.sql), execute:
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

## Migration List

- `20250925100000_add_customer_fields_to_sales.sql` - Adds customer name, phone, and email fields to sales records

## Troubleshooting

If you encounter errors related to missing columns:
1. Ensure all migrations have been applied to your database
2. Check that your database connection settings are correct
3. Restart your development server after applying migrations