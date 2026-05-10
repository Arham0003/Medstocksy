# Vercel Deployment Guide

This guide explains how to deploy the Local Stock application to Vercel and resolve the database migration issue.

## Deploying to Vercel

1. Push your code to GitHub
2. Connect your repository to Vercel
3. Vercel will automatically detect the project settings and deploy the frontend

## Fixing 404 Errors on Page Refresh

To prevent 404 errors when refreshing pages or navigating directly to URLs (like `/products`, `/sales`, etc.), Vercel needs to be configured to serve [index.html](file:///e:/Downloads/local-stock-main/local-stock-main/index.html) for all routes. This allows React Router to handle client-side routing properly.

A `vercel.json` file has been added to the project with the necessary rewrite rules. Make sure this file is included in your deployment.

## Environment Variables

Make sure your Vercel project has the correct environment variables:
- `VITE_SUPABASE_URL` = `https://yuqvtucvqivvvpcfflhq.supabase.co`
- `VITE_SUPABASE_ANON_KEY` = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1cXZ0dWN2cWl2dnZwY2ZmbGhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgxMDA4NDYsImV4cCI6MjA3MzY3Njg0Nn0.k1n8odJZ4uEQXseS2627qYYPqjC0n2gEU07Kxh5de40`

These should be set in the Vercel dashboard under Settings > Environment Variables.

## Fixing Blank Screen Issues

If you're seeing a blank white screen when visiting your deployed application, this is likely due to one of the following issues:

### 1. Missing Environment Variables
Ensure that the required environment variables are set in the Vercel dashboard as mentioned above. Without these, the application cannot connect to Supabase and will fail silently.

### 2. JavaScript Errors
Check the browser's developer console (F12) for any JavaScript errors that might prevent the application from loading.

### 3. Authentication Redirect Loop
The application redirects unauthenticated users to `/auth`. If there are issues with the authentication flow, this could cause a redirect loop or blank screen.

### 4. Large Bundle Size
The application has a large bundle size which might cause loading issues on slower connections. The build process now includes optimized chunking to address this.

### 5. CORS Issues
If the application loads but doesn't display data, there might be CORS issues with the Supabase connection.

## Resolving the Database Issue

After deploying to Vercel, you may still encounter the "Could not find the customer name column" error. This happens because the database migration hasn't been applied to your Supabase project yet.

### Steps to Fix the Database Issue

1. Go to the [Supabase Dashboard](https://app.supabase.com/project/yuqvtucvqivvvpcfflhq/sql)
2. Click on "SQL Editor" in the left sidebar
3. Click "New Query"
4. Copy and paste the following SQL code:
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
5. Click "Run" to execute the query
6. You should see a success message indicating the columns were added

## Verifying the Fix

1. Refresh your Vercel deployment
2. Try recording a sale with customer information
3. The error should no longer appear

## Troubleshooting

If you still encounter issues:

1. Check that the database migration was applied successfully by running:
   ```sql
   SELECT column_name, data_type 
   FROM information_schema.columns 
   WHERE table_name = 'sales' 
   AND column_name IN ('customer_name', 'customer_phone', 'customer_email');
   ```

2. Make sure your Supabase project URL and keys in Vercel match those in your `client.ts` file

3. Restart your Vercel deployment if needed

4. Check the browser console for any error messages

5. Verify that the `vercel.json` file is present in your deployment