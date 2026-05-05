-- _down/0229_reference_documents_force_rls_parent_exists.sql
--
-- Removes the FORCE RLS setting and the canonical policies applied by 0229.
-- After this rollback the tables revert to the state left by 0213 (RLS enabled
-- but not forced, no org-isolation policies). Re-running 0229 restores them.

ALTER TABLE reference_documents NO FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reference_documents_org_isolation ON reference_documents;

ALTER TABLE reference_document_versions NO FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reference_document_versions_org_isolation ON reference_document_versions;
