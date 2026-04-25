-- 0227_rls_hardening_corrective.sql
--
-- Phase 1 RLS hardening: apply FORCE ROW LEVEL SECURITY + canonical
-- app.organisation_id policy on 8 tables that were missing FORCE RLS or
-- used a non-canonical session variable in their original migrations.
--
-- These 8 tables are already ENABLE ROW LEVEL SECURITY'd in their original
-- migrations; this migration adds the missing FORCE RLS statement and
-- replaces any historical policies with a single canonical policy keyed on
-- app.organisation_id (never app.current_organisation_id).
--
-- Idempotent: all DROP POLICY statements use IF EXISTS.
-- Append-only: the original migration files are NOT edited.

-- ── reference_documents ──────────────────────────────────────────────────────
-- Migration 0202 was missing FORCE ROW LEVEL SECURITY.

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

-- ── reference_document_versions ──────────────────────────────────────────────
-- Migration 0203 was missing FORCE ROW LEVEL SECURITY.

ALTER TABLE reference_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reference_document_versions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reference_document_versions_org_isolation ON reference_document_versions;

CREATE POLICY reference_document_versions_org_isolation ON reference_document_versions
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

-- ── memory_review_queue ───────────────────────────────────────────────────────

ALTER TABLE memory_review_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_review_queue FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS memory_review_queue_org_isolation ON memory_review_queue;

CREATE POLICY memory_review_queue_org_isolation ON memory_review_queue
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

-- ── drop_zone_upload_audit ───────────────────────────────────────────────────

ALTER TABLE drop_zone_upload_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE drop_zone_upload_audit FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS drop_zone_upload_audit_tenant_isolation ON drop_zone_upload_audit;
DROP POLICY IF EXISTS drop_zone_upload_audit_org_isolation ON drop_zone_upload_audit;

CREATE POLICY drop_zone_upload_audit_org_isolation ON drop_zone_upload_audit
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

-- ── onboarding_bundle_configs ─────────────────────────────────────────────────

ALTER TABLE onboarding_bundle_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_bundle_configs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onboarding_bundle_configs_tenant_isolation ON onboarding_bundle_configs;
DROP POLICY IF EXISTS onboarding_bundle_configs_org_isolation ON onboarding_bundle_configs;

CREATE POLICY onboarding_bundle_configs_org_isolation ON onboarding_bundle_configs
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

-- ── trust_calibration_state ───────────────────────────────────────────────────

ALTER TABLE trust_calibration_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_calibration_state FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trust_calibration_state_tenant_isolation ON trust_calibration_state;
DROP POLICY IF EXISTS trust_calibration_state_org_isolation ON trust_calibration_state;

CREATE POLICY trust_calibration_state_org_isolation ON trust_calibration_state
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

-- ── agent_test_fixtures ───────────────────────────────────────────────────────

ALTER TABLE agent_test_fixtures ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_test_fixtures FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_test_fixtures_org_isolation ON agent_test_fixtures;

CREATE POLICY agent_test_fixtures_org_isolation ON agent_test_fixtures
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

-- ── agent_execution_events ────────────────────────────────────────────────────

ALTER TABLE agent_execution_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_execution_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_execution_events_org_isolation ON agent_execution_events;

CREATE POLICY agent_execution_events_org_isolation ON agent_execution_events
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

-- ── agent_run_prompts ─────────────────────────────────────────────────────────

ALTER TABLE agent_run_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_run_prompts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_run_prompts_org_isolation ON agent_run_prompts;

CREATE POLICY agent_run_prompts_org_isolation ON agent_run_prompts
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

-- ── agent_run_llm_payloads ────────────────────────────────────────────────────

ALTER TABLE agent_run_llm_payloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_run_llm_payloads FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_run_llm_payloads_org_isolation ON agent_run_llm_payloads;

CREATE POLICY agent_run_llm_payloads_org_isolation ON agent_run_llm_payloads
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
