// NOTE: This module intentionally re-exports the single canonical Supabase
// client from `@/db_conn/supabaseClient`. Previously this file created its own
// `createClient()` instance, which meant the app ran TWO GoTrueClient instances
// against the same localStorage key — causing "Multiple GoTrueClient instances
// detected" and intermittent auth/session/token-refresh races on login.
// Keeping a single instance app-wide is required for reliable auth.
export { supabase } from '@/db_conn/supabaseClient';
