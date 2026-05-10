const { createClient } = require('@supabase/supabase-js');

// Supabase connection details from the client.ts file
const SUPABASE_URL = "https://yuqvtucvqivvvpcfflhq.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1cXZ0dWN2cWl2dnZwY2ZmbGhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgxMDA4NDYsImV4cCI6MjA3MzY3Njg0Nn0.k1n8odJZ4uEQXseS2627qYYPqjC0n2gEU07Kxh5de40";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

async function testConnection() {
  console.log('Testing Supabase connection...');
  
  try {
    // Test basic connection
    const { data, error } = await supabase
      .from('products')
      .select('id')
      .limit(1);
    
    if (error) {
      console.log('Connection error:', error.message);
      return;
    }
    
    console.log('Connection successful');
    
    // Check if customer fields exist in sales table
    console.log('Checking for customer fields in sales table...');
    const { data: salesData, error: salesError } = await supabase
      .from('sales')
      .select('id, customer_name, customer_phone')
      .limit(1);
    
    if (salesError && salesError.message.includes('column')) {
      console.log('Customer fields are missing from sales table');
      console.log('Error:', salesError.message);
    } else if (salesError) {
      console.log('Other sales query error:', salesError.message);
    } else {
      console.log('Customer fields are present in sales table');
    }
    
    // List all columns in sales table
    console.log('Fetching sales table schema...');
    const { data: columns, error: columnsError } = await supabase
      .from('information_schema.columns')
      .select('column_name, data_type')
      .eq('table_name', 'sales')
      .order('ordinal_position');
    
    if (!columnsError) {
      console.log('Sales table columns:');
      columns.forEach(col => {
        console.log(`  ${col.column_name} (${col.data_type})`);
      });
    }
  } catch (err) {
    console.error('Unexpected error:', err);
  }
}

testConnection();