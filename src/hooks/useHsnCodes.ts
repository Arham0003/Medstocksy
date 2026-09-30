import { useCallback, useEffect, useState } from 'react';
import { db } from '@/lib/supabaseLoose';

export interface HsnCode {
  id: string;
  hsn: string;
  description: string | null;
  gst_rate: number;
}

/**
 * The account's HSN master - the source of truth for GST rate on GSTR-1.
 *
 * Fails soft: if the hsn_codes table has not been migrated yet the hook
 * returns an empty list and the caller falls back to a manually typed rate,
 * so an un-migrated database still bills correctly.
 */
export function useHsnCodes(accountId?: string | null) {
  const [codes, setCodes] = useState<HsnCode[]>([]);
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState(true);

  const fetchCodes = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data, error } = await db
      .from('hsn_codes')
      .select('id, hsn, description, gst_rate')
      .eq('account_id', accountId)
      .order('hsn');

    if (error) {
      // 42P01 = relation does not exist -> migration not applied yet.
      setAvailable(false);
      setCodes([]);
    } else {
      setAvailable(true);
      setCodes((data ?? []) as HsnCode[]);
    }
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    void fetchCodes();
  }, [fetchCodes]);

  /** Rate for an HSN, or null when it is not in the master. */
  const rateFor = useCallback(
    (hsn?: string | null) => {
      if (!hsn) return null;
      const match = codes.find((c) => c.hsn === hsn.trim());
      return match ? Number(match.gst_rate) : null;
    },
    [codes],
  );

  return { codes, loading, available, rateFor, refresh: fetchCodes };
}
