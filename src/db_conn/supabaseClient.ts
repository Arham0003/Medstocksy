import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_PUBLISHABLE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  // ponytail: log instead of throw — a module-level throw silently blanks the
  // entire lazy chunk (Sales, SalesBilling…) in production when env vars are
  // missing from the hosting dashboard. Queries will still fail with auth
  // errors, which are surfaced via toasts. Set VITE_SUPABASE_URL and
  // VITE_SUPABASE_PUBLISHABLE_KEY in your hosting env settings to fix.
  console.error(
    '[Medstocksy] Missing Supabase env vars: VITE_SUPABASE_URL and/or VITE_SUPABASE_PUBLISHABLE_KEY. ' +
    'Add them to your hosting dashboard (Vercel/Netlify/etc.) environment variables.'
  );
}

export const supabase = createClient<Database>(SUPABASE_URL ?? '', SUPABASE_PUBLISHABLE_KEY ?? '', {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
