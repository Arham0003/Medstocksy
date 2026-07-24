-- Add a configurable "sales edit window" (in hours) to account settings.
-- A recorded sale can be edited for this many hours after it was created.
-- Default 24h; store owners can change it in Settings.

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS sales_edit_window_hours integer NOT NULL DEFAULT 24;

COMMENT ON COLUMN public.settings.sales_edit_window_hours IS
  'Hours after a sale is recorded during which it can still be edited. Default 24.';
