// Run this script to create the purchase_returns table in Supabase
// Usage: node apply-purchase-return-migration.cjs

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load env from .env file manually (simple parse)
const envPath = path.join(__dirname, '.env');
let supabaseUrl = '';
let supabaseServiceKey = '';

if (fs.existsSync(envPath)) {
  const env = fs.readFileSync(envPath, 'utf8');
  for (const line of env.split('\n')) {
    const [k, ...v] = line.split('=');
    const key = (k || '').trim();
    const val = v.join('=').trim().replace(/^["']|["']$/g, '');
    if (key === 'VITE_SUPABASE_URL') supabaseUrl = val;
    if (key === 'VITE_SUPABASE_SERVICE_ROLE_KEY' || key === 'SUPABASE_SERVICE_ROLE_KEY') supabaseServiceKey = val;
  }
}

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  console.log('\nAlternatively, run this SQL directly in your Supabase SQL Editor:');
  console.log(fs.readFileSync(path.join(__dirname, 'supabase', 'purchase_returns_migration.sql'), 'utf8'));
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const sql = `
CREATE TABLE IF NOT EXISTS purchase_returns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  supplier_id     uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  product_id      uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity        integer NOT NULL CHECK (quantity > 0),
  purchase_price  numeric(10,2) NOT NULL DEFAULT 0,
  return_amount   numeric(10,2) NOT NULL DEFAULT 0,
  reason          text,
  return_date     date NOT NULL DEFAULT CURRENT_DATE,
  batch_number    text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE purchase_returns ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'purchase_returns' AND policyname = 'Users can manage their own purchase returns'
  ) THEN
    CREATE POLICY "Users can manage their own purchase returns"
      ON purchase_returns FOR ALL
      USING (account_id = (SELECT account_id FROM profiles WHERE id = auth.uid()))
      WITH CHECK (account_id = (SELECT account_id FROM profiles WHERE id = auth.uid()));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_purchase_returns_supplier ON purchase_returns(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_product  ON purchase_returns(product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_account  ON purchase_returns(account_id);
`;

async function run() {
  console.log('🔄 Applying purchase_returns migration...\n');
  const { error } = await supabase.rpc('exec_sql', { sql }).catch(() => ({ error: null }));
  
  // Try direct query as fallback
  const { error: err2 } = await supabase.from('purchase_returns').select('id').limit(1);
  if (!err2) {
    console.log('✅ Table purchase_returns already exists or was created!');
    return;
  }

  console.log('\n📋 Please run this SQL manually in your Supabase SQL Editor (https://supabase.com/dashboard):');
  console.log('─'.repeat(60));
  console.log(fs.readFileSync(path.join(__dirname, 'supabase', 'purchase_returns_migration.sql'), 'utf8'));
}

run();
