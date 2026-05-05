-- 0229_reference_documents_force_rls_parent_exists.sql
--
-- Dedicated corrective migration for reference_documents and
-- reference_document_versions.
--
-- Migration 0213 repaired both tables at runtime: it dropped the broken
-- `app.current_organisation_id` policies from 0202/0203, applied FORCE ROW
-- LEVEL SECURITY, and recreated canonical policies using `app.organisation_id`.
--
-- This migration is the manifest-pointed corrective entry for those two tables
-- so that verify-rls-coverage.sh no longer requires the 0202/0203 baseline
-- exemptions. All statements are idempotent.
--
-- reference_document_versions uses the parent-EXISTS policy variant because
-- that table has no organisation_id column — org scope is inherited via the
-- parent reference_documents row.

-- ---------------------------------------------------------------------------
-- reference_documents
-- ---------------------------------------------------------------------------

ALTER TABLE reference_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE reference_documents FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reference_documents_org_isolation ON reference_documents;
CREATE POLICY reference_documents_org_isolation ON reference_documents
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

-- Drop the broken subaccount isolation policy from 0202 if it survived 0213.
DROP POLICY IF EXISTS reference_documents_subaccount_isolation ON reference_documents;

-- ---------------------------------------------------------------------------
-- reference_document_versions (inherits org scope via parent document)
-- ---------------------------------------------------------------------------

ALTER TABLE reference_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reference_document_versions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reference_document_versions_org_isolation ON reference_document_versions;
CREATE POLICY reference_document_versions_org_isolation ON reference_document_versions
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND EXISTS (
      SELECT 1 FROM reference_documents
      WHERE reference_documents.id = reference_document_versions.document_id
        AND reference_documents.organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND EXISTS (
      SELECT 1 FROM reference_documents
      WHERE reference_documents.id = reference_document_versions.document_id
        AND reference_documents.organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  );
