const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = "https://yuqvtucvqivvvpcfflhq.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1cXZ0dWN2cWl2dnZwY2ZmbGhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgxMDA4NDYsImV4cCI6MjA3MzY3Njg0Nn0.k1n8odJZ4uEQXseS2627qYYPqjC0n2gEU07Kxh5de40";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

async function cleanNegativePayments() {
  console.log('Fetching negative supplier payments...');
  try {
    const { data, error } = await supabase
      .from('supplier_payments')
      .select('id, amount, payment_type')
      .lt('amount', 0);
      
    if (error) {
      console.error('Error fetching payments:', error);
      return;
    }
    
    console.log(`Found ${data.length} negative payments to delete.`);
    
    for (const payment of data) {
      console.log(`Deleting payment ID ${payment.id} with amount ${payment.amount}...`);
      const { error: delError } = await supabase
        .from('supplier_payments')
        .delete()
        .eq('id', payment.id);
        
      if (delError) {
        console.error(`Error deleting ${payment.id}:`, delError);
      } else {
        console.log(`Successfully deleted ${payment.id}`);
      }
    }
    
    console.log('Cleanup complete!');
  } catch (err) {
    console.error('Unexpected error:', err);
  }
}

cleanNegativePayments();
