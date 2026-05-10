const { createClient } = require('@supabase/supabase-js');

// const SUPABASE_URL = "https://uefmakbsnmpvhgftunac.supabase.co";
// const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlZm1ha2Jzbm1wdmhnZnR1bmFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMjgyNjEsImV4cCI6MjA5MDYwNDI2MX0.p5R1pHLiY1pfKHdPOC3yzZZPAweDkpVj93bLvdBEfb8";
export { supabase } from '@/db conn/supabaseClient';
// We'll use the Supabase management API via direct fetch with service role
// But first let's try with anon key to check what we can do

async function runMigration() {
  const fs = require('fs');
  const sql = fs.readFileSync('./supabase/migrations/20260401_create_suppliers.sql', 'utf8');
  
  console.log("Running migration via Supabase REST...");
  
  // Split SQL into individual statements
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));
  
  console.log(`Found ${statements.length} SQL statements to execute`);
  
  // Use fetch to call Supabase's postgres endpoint
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    if (!stmt || stmt.startsWith('--')) continue;
    
    console.log(`\nExecuting statement ${i+1}: ${stmt.substring(0, 80)}...`);
    
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql: stmt })
      });
      
      if (!response.ok) {
        const text = await response.text();
        console.log(`  Status: ${response.status} - ${text}`);
      } else {
        console.log(`  ✓ Success`);
      }
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
  }
  
  // Now try direct table operations to verify
  console.log("\n=== Verifying tables exist ===");
  try {
    // Check if suppliers table exists by trying to count
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/suppliers?select=count`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'count=exact',
        'Range': '0-0'
      }
    });
    console.log(`suppliers table: ${resp.status === 200 || resp.status === 206 ? '✓ EXISTS' : '✗ NOT FOUND - Status: ' + resp.status}`);
    if (!resp.ok) {
      const t = await resp.text();
      console.log("Error:", t);
    }
  } catch(e) {
    console.log("Error checking suppliers:", e.message);
  }
  
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/supplier_payments?select=count`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'count=exact',
        'Range': '0-0'
      }
    });
    console.log(`supplier_payments table: ${resp.status === 200 || resp.status === 206 ? '✓ EXISTS' : '✗ NOT FOUND - Status: ' + resp.status}`);
    if (!resp.ok) {
      const t = await resp.text();
      console.log("Error:", t);
    }
  } catch(e) {
    console.log("Error checking supplier_payments:", e.message);
  }
}

runMigration().catch(console.error);
