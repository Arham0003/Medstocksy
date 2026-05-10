-- Migration: Add doctor_name and sale_date to sales table
-- Run this in your Supabase SQL Editor

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS doctor_name TEXT,
  ADD COLUMN IF NOT EXISTS sale_date DATE;

-- Back-fill sale_date from created_at for existing rows
UPDATE sales SET sale_date = created_at::DATE WHERE sale_date IS NULL;

-- Add indexes for faster CRM lookups
CREATE INDEX IF NOT EXISTS idx_sales_doctor_name ON sales (doctor_name);
CREATE INDEX IF NOT EXISTS idx_sales_sale_date ON sales (sale_date);
