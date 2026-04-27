-- 0228_phantom_var_sweep.sql
--
-- Idempotent re-sweep of the RLS policies originally defined in migrations
-- 0204-0208 and 0212 with the phantom `app.current_organisation_id` variable.
-- Migration 0213 repaired the database at runtime by dropping the broken
-- policies and recreating them with the canonical `app.organisation_id`
-- variable, the IS NOT NULL / non-empty guards, and WITH CHECK clauses.
--
-- This migration provides an explicit audit-trail entry so the migration
-- manifest can point directly to 0228 rather than relying solely on 0213 for
-- these six tables. All statements are idempotent (DROP IF EXISTS + CREATE
-- POLICY on a policy name 0213 already established).
--
-- FORCE ROW LEVEL SECURITY is intentionally omitted here — it was applied by
-- 0213 and 0227 and does not need to be repeated.
--
-- Uses the canonical policy pattern from 0213 (which itself mirrors
-- 0200_fix_universal_brief_rls.sql).

-- ---------------------------------------------------------------------------
-- document_bundles
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- document_bundle_members (inherits org scope via parent bundle)
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- bundle_resolution_snapshots
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- model_tier_budget_policies (custom shape: SELECT allows platform-default
-- rows for all orgs; FOR ALL narrows writes to matching org)
-- ---------------------------------------------------------------------------

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
