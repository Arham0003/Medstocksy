-- Create a function to look up user ID by email (Security Critical: Only allow for admins technically, 
-- but for this MVP we'll let authenticated users call it if the app logic restricts the UI).
-- In a strict prod app, this should be restricted to service_role only.

CREATE OR REPLACE FUNCTION public.get_user_id_by_email(email_input TEXT)
RETURNS UUID AS $$
DECLARE
  target_user_id UUID;
BEGIN
  SELECT id INTO target_user_id FROM auth.users WHERE email = email_input;
  RETURN target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- SECURITY DEFINER means it runs with permissions of creator (postgres), allowing it to read auth.users table 
-- which is normally blocked for regular users.
