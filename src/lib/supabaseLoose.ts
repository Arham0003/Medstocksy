/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from '@/db_conn/supabaseClient';

/**
 * Untyped view of the Supabase client.
 *
 * `src/integrations/supabase/types.ts` is hand-maintained and already lags
 * the schema - it has no `purchase_returns`, no `bill_id`, no `payment_mode`
 * - and it does not know about the compliance tables and columns added by
 * the 2026-09-10 migrations (`stock_batches`, `hsn_codes`, the GST-split
 * columns on `sales`, or any of the new RPCs).
 *
 * Rather than sprinkle `as any` over every call, the escape hatch lives here
 * once, with the reason attached.
 *
 * To remove it: regenerate the types against the migrated database
 *   npx supabase gen types typescript --project-id <id> > src/integrations/supabase/types.ts
 * then switch these callers back to the typed `supabase` client.
 */
export const db = supabase as any;
