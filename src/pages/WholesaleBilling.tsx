import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWholesaleAccess } from '@/hooks/useWholesaleAccess';
import SalesBilling from './SalesBilling';

/**
 * /wholesale — the B2B billing workspace.
 *
 * Thin gate over SalesBilling so there is exactly one billing screen to
 * maintain. Reaching this URL without an active wholesale plan (or with the
 * Settings toggle off) sends the user to the plans page; the RLS policy on
 * `sales` blocks the insert regardless of what the frontend does.
 */
export default function WholesaleBilling() {
  const { isActive, loading } = useWholesaleAccess();
  const navigate = useNavigate();

  useEffect(() => {
    // Wait for the answer — `isActive` is false while the check is in flight,
    // so redirecting early would bounce paying subscribers.
    if (!loading && !isActive) navigate('/pricing', { replace: true });
  }, [isActive, loading, navigate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  if (!isActive) return null; // redirecting

  return <SalesBilling mode="wholesale" />;
}
