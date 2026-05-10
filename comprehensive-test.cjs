const { createClient } = require('@supabase/supabase-js');

// Supabase connection details from the client.ts file
const SUPABASE_URL = "https://yuqvtucvqivvvpcfflhq.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1cXZ0dWN2cWl2dnZwY2ZmbGhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgxMDA4NDYsImV4cCI6MjA3MzY3Njg0Nn0.k1n8odJZ4uEQXseS2627qYYPqjC0n2gEU07Kxh5de40";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

async function comprehensiveTest() {
  console.log('=== Comprehensive Supabase Connection Test ===\n');
  
  try {
    console.log('1. Testing basic connection...');
    const { data: productData, error: productError } = await supabase
      .from('products')
      .select('id, name')
      .limit(2);
    
    if (productError) {
      console.log('❌ Basic connection failed:', productError.message);
      return;
    }
    
    console.log('✅ Basic connection successful');
    console.log('   Sample products:', productData?.length || 0);
    
    console.log('\n2. Testing sales table access...');
    const { data: salesData, error: salesError } = await supabase
      .from('sales')
      .select('id, product_id, quantity')
      .limit(2);
    
    if (salesError) {
      console.log('❌ Sales table access failed:', salesError.message);
      return;
    }
    
    console.log('✅ Sales table access successful');
    console.log('   Sample sales:', salesData?.length || 0);
    
    console.log('\n3. Testing customer fields in sales table...');
    const { data: customerData, error: customerError } = await supabase
      .from('sales')
      .select('id, customer_name, customer_phone')
      .limit(2);
    
    if (customerError) {
      console.log('❌ Customer fields test failed:', customerError.message);
      // Try without customer fields to see what works
      console.log('   Testing without customer fields...');
      const { data: basicSalesData, error: basicSalesError } = await supabase
        .from('sales')
        .select('id, product_id, quantity, unit_price')
        .limit(2);
      
      if (basicSalesError) {
        console.log('   ❌ Even basic sales query failed:', basicSalesError.message);
      } else {
        console.log('   ✅ Basic sales query works, customer fields are missing');
      }
    } else {
      console.log('✅ Customer fields are available');
      console.log('   Sample with customer data:', customerData?.length || 0);
    }
    
    console.log('\n4. Testing product count...');
    const { count, error: countError } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true });
    
    if (countError) {
      console.log('❌ Product count failed:', countError.message);
    } else {
      console.log('✅ Product count successful:', count);
    }
    
    console.log('\n5. Testing table schema...');
    const { data: columns, error: columnsError } = await supabase
      .from('information_schema.columns')
      .select('column_name')
      .eq('table_name', 'sales')
      .in('column_name', ['customer_name', 'customer_phone', 'customer_email']);
    
    if (columnsError) {
      console.log('❌ Schema query failed:', columnsError.message);
    } else {
      console.log('✅ Schema query successful');
      const foundColumns = columns.map(col => col.column_name);
      console.log('   Customer-related columns found:', foundColumns.join(', ') || 'None');
    }
    
    console.log('\n=== Test Complete ===');
    
  } catch (err) {
    console.error('Unexpected error:', err);
  }
}

comprehensiveTest();