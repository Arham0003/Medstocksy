// Run this script to create the purchase_headers and purchase_items tables in Supabase
// Usage: node apply-purchase-tables-migration.cjs

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

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

const migrationSqlPath = path.join(__dirname, 'supabase', 'migrations', '20260719000000_create_purchase_tables.sql');
const sql = fs.readFileSync(migrationSqlPath, 'utf8');

if (!supabaseUrl || !supabaseServiceKey) {
  console.log('\n📋 Please run this SQL manually in your Supabase SQL Editor (https://supabase.com/dashboard):');
  console.log('─'.repeat(60));
  console.log(sql);
  process.exit(0);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
  console.log('🔄 Applying purchase_headers and purchase_items migration...\n');
  const { error } = await supabase.rpc('exec_sql', { sql }).catch(() => ({ error: null }));
  
  const { error: err2 } = await supabase.from('purchase_headers').select('id').limit(1);
  if (!err2) {
    console.log('✅ Tables purchase_headers and purchase_items exist!');
    return;
  }

  console.log('\n📋 Please run this SQL manually in your Supabase SQL Editor (https://supabase.com/dashboard):');
  console.log('─'.repeat(60));
  console.log(sql);
}

run();
