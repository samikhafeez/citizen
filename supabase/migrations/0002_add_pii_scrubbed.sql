-- 0002 — add responses.pii_scrubbed (forward migration)
--
-- The current schema (0001) already defines responses.pii_scrubbed for FRESH setups.
-- This migration brings EXISTING Supabase projects — created from an earlier 0001 that
-- did not have the column — up to date. It is idempotent and safe to run more than once.
--
-- Symptom this fixes: saving a survey response fails because the app writes a
-- `pii_scrubbed` value but the column does not exist in an older database.

alter table responses
  add column if not exists pii_scrubbed boolean not null default false;

comment on column responses.pii_scrubbed is
  'true when free_text was PII-scrubbed before storage (set by the app on the write path)';

-- Ask PostgREST (Supabase API) to reload its schema cache so the new column is exposed
-- immediately without waiting for the periodic reload.
notify pgrst, 'reload schema';
