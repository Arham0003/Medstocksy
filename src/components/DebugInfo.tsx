import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/db conn/supabaseClient';

const DebugInfo = () => {
  const { user, profile, loading } = useAuth();
  const [debugInfo, setDebugInfo] = useState<any>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDebugInfo = async () => {
      try {
        // Test Supabase connection with a simple query
        const { data, error } = await supabase
          .from('products')
          .select('id')
          .limit(1);
        
        // Check if customer fields exist in sales table using a more robust method
        let customerFieldsStatus = 'Unknown';
        try {
          // Try to select customer fields with a simple query
          const { data: salesData, error: salesError } = await supabase
            .from('sales')
            .select('id')
            .limit(1);
          
          if (salesError) {
            customerFieldsStatus = `Error: ${salesError.message}`;
          } else {
            // If basic query works, try with customer fields
            const { data: customerData, error: customerError } = await supabase
              .from('sales')
              .select('id, customer_name, customer_phone')
              .limit(1);
            
            if (customerError && customerError.message.includes('column')) {
              customerFieldsStatus = 'Missing';
            } else if (customerError) {
              customerFieldsStatus = `Error: ${customerError.message}`;
            } else {
              customerFieldsStatus = 'Available';
            }
          }
        } catch (e: any) {
          customerFieldsStatus = `Exception: ${e.message}`;
        }
        
        // Get product count using a safer method
        let productCount = 'Unknown';
        try {
          const { count, error: countError } = await supabase
            .from('products')
            .select('*', { count: 'exact', head: true });
          
          if (!countError && count !== null) {
            productCount = count.toString();
          } else if (countError) {
            productCount = `Error: ${countError.message}`;
          }
        } catch (e: any) {
          productCount = `Exception: ${e.message}`;
        }
        
        setDebugInfo({
          user: user ? 'Authenticated' : 'Not authenticated',
          profile: profile ? 'Profile loaded' : 'No profile',
          loading: loading ? 'Loading' : 'Not loading',
          supabaseConnection: error ? `Error: ${error.message}` : 'Connected',
          customerFields: customerFieldsStatus,
          productCount: productCount,
          productSample: data && data.length > 0 ? 'Found' : 'None'
        });
      } catch (err: any) {
        setError(err.message || 'Unknown error');
        // Set debug info even when there's an error
        setDebugInfo({
          user: user ? 'Authenticated' : 'Not authenticated',
          profile: profile ? 'Profile loaded' : 'No profile',
          loading: loading ? 'Loading' : 'Not loading',
          error: err.message || 'Unknown error'
        });
      }
    };

    if (!loading) {
      fetchDebugInfo();
    }
  }, [user, profile, loading]);

  if (import.meta.env.MODE === 'production') {
    return null; // Don't show in production
  }

  return (
    <div className="fixed bottom-0 right-0 bg-red-100 border border-red-400 text-red-700 p-4 m-4 rounded z-50 max-w-md">
      <h3 className="font-bold">Debug Info</h3>
      <pre className="text-xs overflow-auto">
        {JSON.stringify(debugInfo, null, 2)}
      </pre>
      {error && <p className="text-red-500">Error: {error}</p>}
    </div>
  );
};

export default DebugInfo;
