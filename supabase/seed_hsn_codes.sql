-- ============================================================
-- One-time DML - seed common pharma HSN codes for every account.
-- Run AFTER 20260910000000_create_hsn_codes.sql, in the Supabase SQL editor.
-- Safe to re-run: ON CONFLICT DO NOTHING keeps owner edits intact.
--
-- Rates below are the common pharma defaults. Verify against the current
-- CBIC rate notification before relying on them for a filed return.
-- ============================================================

INSERT INTO public.hsn_codes (account_id, hsn, description, gst_rate)
SELECT a.id, v.hsn, v.description, v.gst_rate
FROM public.accounts a
CROSS JOIN (VALUES
  ('30049099', 'Medicaments (general)',        12),
  ('30059010', 'Dressings / Bandages',          5),
  ('30061010', 'Surgical Gloves',               5),
  ('30049011', 'Ayurvedic medicines',          12),
  ('30021200', 'Antisera / Vaccines',           5),
  ('90183900', 'Syringes / Needles / Catheters',12),
  ('21069099', 'Food supplements',             18),
  ('33049990', 'Cosmetics / Skin care',        18),
  ('00000000', 'Exempt / Nil rated',            0)
) AS v(hsn, description, gst_rate)
ON CONFLICT (account_id, hsn) DO NOTHING;
