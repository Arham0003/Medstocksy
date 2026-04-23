// Direct Supabase migration using pg endpoint
// Uses the management API to run raw SQL

// const SUPABASE_PROJECT_ID = "uefmakbsnmpvhgftunac";
// const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlZm1ha2Jzbm1wdmhnZnR1bmFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMjgyNjEsImV4cCI6MjA5MDYwNDI2MX0.p5R1pHLiY1pfKHdPOC3yzZZPAweDkpVj93bLvdBEfb8";
export { supabase } from '@/db conn/supabaseClient';
// Check if tables exist already
async function checkTables() {
  const tables = ['suppliers', 'supplier_payments'];

  for (const table of tables) {
    try {
      const resp = await fetch(`https://${SUPABASE_PROJECT_ID}.supabase.co/rest/v1/${table}?select=id&limit=1`, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        }
      });
      const text = await resp.text();
      console.log(`Table '${table}': status=${resp.status}, response=${text.substring(0,200)}`);

      if (resp.status === 200 || resp.status === 206) {
        console.log(`  ✓ Table '${table}' EXISTS`);
      } else if (resp.status === 401 || resp.status === 403) {
        console.log(`  ✓ Table '${table}' EXISTS (auth required - RLS active)`);
      } else {
        console.log(`  ✗ Table '${table}' does NOT exist`);
      }
    } catch(e) {
      console.log(`  Error: ${e.message}`);
    }
  }
  
  // Check products table for supplier_id column
  try {
    const resp = await fetch(`https://${SUPABASE_PROJECT_ID}.supabase.co/rest/v1/products?select=supplier_id&limit=1`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      }
    });
    const text = await resp.text();
    console.log(`\nColumn 'products.supplier_id': status=${resp.status}`);
    if (text.includes('supplier_id') || resp.status !== 400) {
      console.log(`  ✓ Column 'supplier_id' EXISTS in products`);
    } else {
      console.log(`  ✗ Column 'supplier_id' does NOT exist. Response: ${text.substring(0,200)}`);
    }
  } catch(e) {
    console.log(`  Error: ${e.message}`);
  }
}

checkTables();
