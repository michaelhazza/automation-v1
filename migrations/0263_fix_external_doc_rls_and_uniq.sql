-- 0263_fix_external_doc_rls_and_uniq.sql
-- Corrects two issues from 0262:
--   1. document_cache and document_fetch_events RLS policies used the wrong GUC
--      (app.current_subaccount_id). Replaced with canonical org_isolation shape.
--   2. reference_documents_external_uniq index did not exclude soft-deleted rows.
--      Replaced with a predicate that includes AND deleted_at IS NULL.

BEGIN;

-- 1. Fix document_cache RLS policy ------------------------------------------

ALTER TABLE document_cache FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_cache_isolation ON document_cache;
CREATE POLICY document_cache_org_isolation ON document_cache
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- 2. Fix document_fetch_events RLS policy ------------------------------------

ALTER TABLE document_fetch_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_fetch_events_isolation ON document_fetch_events;
CREATE POLICY document_fetch_events_org_isolation ON document_fetch_events
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- 3. Fix reference_documents unique index to exclude soft-deleted rows --------

DROP INDEX IF EXISTS reference_documents_external_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS reference_documents_external_uniq
  ON reference_documents (external_file_id, external_connection_id)
  WHERE source_type = 'google_drive' AND deleted_at IS NULL;

COMMIT;
