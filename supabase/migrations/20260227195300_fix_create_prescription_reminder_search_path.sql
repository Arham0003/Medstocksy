-- Fix mutable search_path for create_prescription_reminder
-- This addresses a security advisor warning in Supabase
-- Ensure the function has a fixed search_path to prevent shadowing attacks

DO $$
DECLARE
    func_record RECORD;
BEGIN
    FOR func_record IN 
        SELECT p.proname, pg_get_function_identity_arguments(p.oid) as args
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'create_prescription_reminder'
    LOOP
        EXECUTE 'ALTER FUNCTION public.' || func_record.proname || '(' || func_record.args || ') SET search_path = public';
    END LOOP;
END $$;
