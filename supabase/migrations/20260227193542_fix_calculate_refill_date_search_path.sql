-- Fix mutable search_path for calculate_refill_date
-- This addresses a security advisor warning in Supabase
-- Ensure the function has a fixed search_path to prevent shadowing attacks

-- Since the function might have different signatures, we try both common ones
-- Feel free to adjust the parameters if your version differs

DO $$
BEGIN
    -- Fix for the common signature calculate_refill_date(timestamptz, integer)
    IF EXISTS (
        SELECT 1 FROM pg_proc p 
        JOIN pg_namespace n ON p.pronamespace = n.oid 
        WHERE n.nspname = 'public' AND p.proname = 'calculate_refill_date'
    ) THEN
        -- We apply the search_path fix to all functions named calculate_refill_date in public schema
        -- This is safer when we don't know the exact signature
        PERFORM 'ALTER FUNCTION public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') SET search_path = public'
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'calculate_refill_date';
        
        -- Since PERFORM doesn't execute the string as a command, we need to use EXECUTE in a loop
    END IF;
END $$;

-- Dynamic fix using EXECUTE
DO $$
DECLARE
    func_record RECORD;
BEGIN
    FOR func_record IN 
        SELECT p.proname, pg_get_function_identity_arguments(p.oid) as args
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'calculate_refill_date'
    LOOP
        EXECUTE 'ALTER FUNCTION public.' || func_record.proname || '(' || func_record.args || ') SET search_path = public';
    END LOOP;
END $$;
