-- 0213_fix_cached_context_rls.sql
--
-- Cached Context Infrastructure — repair Row Level Security on the eight
-- tables introduced by migrations 0202-0208 and 0212. The original policies
-- referenced `app.current_organisation_id`, a session variable that is never
-- set in this codebase. The canonical variable is `app.organisation_id` (see
-- migrations 0079-0081, 0200, server/middleware/auth.ts, and
-- server/lib/createWorker.ts).
--
-- The original migrations also omitted FORCE ROW LEVEL SECURITY (Postgres
-- bypasses RLS for the table owner without it) and the explicit IS NOT NULL
-- / non-empty guards + WITH CHECK clause that the 0079 / 0200 canonical
-- pattern uses.
--
-- This migration drops the broken policies and recreates them matching the
-- canonical pattern from 0200_fix_universal_brief_rls.sql so tenant
-- isolation is enforced at the database layer regardless of the
-- migration-runner's ownership.
--
-- Scope: this migration only enforces ORG-level isolation at the DB layer.
-- The original 0202–0207/0212 migrations also defined `*_subaccount_isolation`
-- policies that required `app.current_subaccount_id`, but the normal request
-- paths (server/middleware/auth.ts) and worker paths (server/lib/createWorker.ts)
-- never set that session variable — only `withPrincipalContext` does, and it
-- is only invoked from the CRM query planner. Under the original migrations
-- this was latent because FORCE ROW LEVEL SECURITY was missing (the app role
-- owned the tables and therefore bypassed RLS). Turning FORCE on without also
-- initialising `app.current_subaccount_id` would block every insert/read of
-- any subaccount-scoped row. Instead we drop the broken subaccount policies
-- entirely and rely on the service layer's explicit `subaccount_id` filter
-- (see referenceDocumentService.listByOrg, documentBundleService listing,
-- etc.) — the same posture used by memory_blocks, workspace_memories, and
-- all other tenant-scoped tables outside the principal-aware canonical CRM
-- tables. This matches the 0200 Universal Brief repair precedent.

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

-- Drop the broken subaccount policy — see header note. Subaccount scoping
-- is enforced by the service layer's explicit subaccount_id filter.
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
      SELECT 1 FROM reference_documents rd
      WHERE rd.id = document_id
        AND rd.organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND EXISTS (
      SELECT 1 FROM reference_documents rd
      WHERE rd.id = document_id
        AND rd.organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  );

-- ---------------------------------------------------------------------------
-- document_bundles
-- ---------------------------------------------------------------------------

ALTER TABLE document_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_bundles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_bundles_org_isolation ON document_bundles;
CREATE POLICY document_bundles_org_isolation ON document_bundles
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

-- Drop the broken subaccount policy — see header note. Subaccount scoping
-- is enforced by the service layer's explicit subaccount_id filter.
DROP POLICY IF EXISTS document_bundles_subaccount_isolation ON document_bundles;

-- ---------------------------------------------------------------------------
-- document_bundle_members (inherits org scope via parent bundle)
-- ---------------------------------------------------------------------------

ALTER TABLE document_bundle_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_bundle_members FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_bundle_members_org_isolation ON document_bundle_members;
CREATE POLICY document_bundle_members_org_isolation ON document_bundle_members
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND EXISTS (
      SELECT 1 FROM document_bundles db
      WHERE db.id = bundle_id
        AND db.organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND EXISTS (
      SELECT 1 FROM document_bundles db
      WHERE db.id = bundle_id
        AND db.organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  );

-- ---------------------------------------------------------------------------
-- document_bundle_attachments
-- ---------------------------------------------------------------------------

ALTER TABLE document_bundle_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_bundle_attachments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_bundle_attachments_org_isolation ON document_bundle_attachments;
CREATE POLICY document_bundle_attachments_org_isolation ON document_bundle_attachments
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

-- Drop the broken subaccount policy — see header note. Subaccount scoping
-- is enforced by the service layer's explicit subaccount_id filter.
DROP POLICY IF EXISTS document_bundle_attachments_subaccount_isolation ON document_bundle_attachments;

-- ---------------------------------------------------------------------------
-- bundle_resolution_snapshots
-- ---------------------------------------------------------------------------

ALTER TABLE bundle_resolution_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE bundle_resolution_snapshots FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bundle_resolution_snapshots_org_isolation ON bundle_resolution_snapshots;
CREATE POLICY bundle_resolution_snapshots_org_isolation ON bundle_resolution_snapshots
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

-- Drop the broken subaccount policy — see header note. Subaccount scoping
-- is enforced by the service layer's explicit subaccount_id filter.
DROP POLICY IF EXISTS bundle_resolution_snapshots_subaccount_isolation ON bundle_resolution_snapshots;

-- ---------------------------------------------------------------------------
-- model_tier_budget_policies (custom shape: SELECT allows platform-default
-- rows for all orgs; FOR ALL narrows writes to matching org)
-- ---------------------------------------------------------------------------

ALTER TABLE model_tier_budget_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_tier_budget_policies FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS model_tier_budget_policies_read ON model_tier_budget_policies;
CREATE POLICY model_tier_budget_policies_read ON model_tier_budget_policies
  FOR SELECT
  USING (
    organisation_id IS NULL
    OR (
      current_setting('app.organisation_id', true) IS NOT NULL
      AND current_setting('app.organisation_id', true) <> ''
      AND organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  );

DROP POLICY IF EXISTS model_tier_budget_policies_write ON model_tier_budget_policies;
CREATE POLICY model_tier_budget_policies_write ON model_tier_budget_policies
  FOR ALL
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

-- ---------------------------------------------------------------------------
-- bundle_suggestion_dismissals
-- ---------------------------------------------------------------------------

ALTER TABLE bundle_suggestion_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE bundle_suggestion_dismissals FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bundle_suggestion_dismissals_org_isolation ON bundle_suggestion_dismissals;
CREATE POLICY bundle_suggestion_dismissals_org_isolation ON bundle_suggestion_dismissals
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

-- Drop the broken subaccount policy — see header note. Subaccount scoping
-- is enforced by the service layer's explicit subaccount_id filter.
DROP POLICY IF EXISTS bundle_suggestion_dismissals_subaccount_isolation ON bundle_suggestion_dismissals;
