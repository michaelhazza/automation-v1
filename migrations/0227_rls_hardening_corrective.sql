-- 0227_rls_hardening_corrective.sql
--
-- Phase 1A corrective migration — RLS hardening for tables that were missing
-- FORCE ROW LEVEL SECURITY or had policies using phantom session variables.
--
-- Tables addressed:
--   - memory_review_queue (0139)        — missing FORCE; policy lacks WITH CHECK / guards
--   - drop_zone_upload_audit (0141)     — missing FORCE; policy lacks WITH CHECK / guards
--   - onboarding_bundle_configs (0142)  — missing FORCE; policy lacks WITH CHECK / guards
--   - trust_calibration_state (0147)    — missing FORCE; policy lacks WITH CHECK / guards
--   - agent_test_fixtures (0153)        — missing FORCE; policy lacks WITH CHECK / guards
--   - agent_execution_events (0192)     — FORCE re-assertion (gate regex: double-space)
--   - agent_run_prompts (0192)          — FORCE re-assertion (gate regex: double-space)
--   - agent_run_llm_payloads (0192)     — FORCE re-assertion (gate regex: double-space)
--   - reference_documents (0202)        — missing FORCE (policy text is correct)
--   - reference_document_versions (0203)— missing FORCE (policy text is correct)
--
-- Canonical policy pattern mirrors migration 0213_fix_cached_context_rls.sql.
-- All DROP POLICY calls are idempotent (IF EXISTS).
--
-- Audit spec: docs/superpowers/specs/2026-04-25-codebase-audit-remediation-spec.md §4.1
-- Finding origins: P3-C1, P3-C2, P3-C3, P3-C4 (audit), plus 0153/0192 gate gaps.

-- ── memory_review_queue ─────────────────────────────────────────────────────

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

-- ── drop_zone_upload_audit ──────────────────────────────────────────────────

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

-- ── onboarding_bundle_configs ───────────────────────────────────────────────

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

-- ── trust_calibration_state ─────────────────────────────────────────────────

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

-- ── agent_test_fixtures ─────────────────────────────────────────────────────

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

-- ── agent_execution_events (re-assertion — 0192 used double-space FORCE) ───

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

-- ── agent_run_prompts (re-assertion — 0192 used double-space FORCE) ─────────

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

-- ── agent_run_llm_payloads (re-assertion — 0192 used double-space FORCE) ────

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

-- ── reference_documents (0202 — correct policy text, only FORCE missing) ────

ALTER TABLE reference_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE reference_documents FORCE ROW LEVEL SECURITY;

-- ── reference_document_versions (0203 — correct policy text, only FORCE missing)

ALTER TABLE reference_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reference_document_versions FORCE ROW LEVEL SECURITY;
