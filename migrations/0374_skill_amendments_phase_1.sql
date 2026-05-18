-- 0374_skill_amendments_phase_1.sql
-- Closed-Loop Skill Improvement — Chunk 1 schema (spec §7).
--
-- Creates all 8 new tables for the closed-loop amendment pipeline.
-- 7 tables are org-scoped with FORCE RLS + canonical org-isolation policy.
-- amendment_proposer_metrics is system-scoped (no RLS) — per-proposer-model-version
-- quality telemetry, never tenant-bound (§7.5 + §14).
--
-- UNIQUE NULLS NOT DISTINCT on skill_amendment_run_snapshot requires PostgreSQL 15+.

-- ---------------------------------------------------------------------------
-- skill_amendments
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS skill_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid NOT NULL REFERENCES subaccounts(id),
  system_skill_id uuid REFERENCES system_skills(id),
  org_skill_id uuid REFERENCES skills(id),
  -- exactly one of system_skill_id / org_skill_id must be non-null
  CONSTRAINT skill_amendments_skill_xor_ck
    CHECK ((system_skill_id IS NOT NULL) <> (org_skill_id IS NOT NULL)),
  kind text NOT NULL
    CONSTRAINT skill_amendments_kind_ck
      CHECK (kind IN ('instruction_extension','example','guardrail','context_fact','exception')),
  status text NOT NULL DEFAULT 'draft'
    CONSTRAINT skill_amendments_status_ck
      CHECK (status IN ('draft','pending_review','accepted','rejected','retired')),
  source text NOT NULL
    CONSTRAINT skill_amendments_source_ck
      CHECK (source IN ('agent_proposed_from_failure','operator_manual')),
  body text NOT NULL,
  -- Per-kind body-length guards
  CONSTRAINT skill_amendments_body_length_ck
    CHECK (
      (kind = 'instruction_extension' AND length(body) <= 800) OR
      (kind = 'example'               AND length(body) <= 1500) OR
      (kind = 'guardrail'             AND length(body) <= 400) OR
      (kind = 'context_fact'          AND length(body) <= 300) OR
      (kind = 'exception'             AND length(body) <= 600)
    ),
  blast_radius_estimate text NOT NULL
    CONSTRAINT skill_amendments_blast_radius_ck
      CHECK (blast_radius_estimate IN ('low','medium','high')),
  confidence double precision,
  version_number integer NOT NULL DEFAULT 1,
  -- lineage_root_id: self-reference, no FK (same-table circular reference omitted by design)
  lineage_root_id uuid,
  -- scorecard_judgement_id: FK target not yet identified; added Phase 2
  scorecard_judgement_id uuid,
  rca_record_id uuid,
  rca_json jsonb,
  proposer_run_id uuid,
  proposer_model_version text,
  peer_reviewer_model_version text,
  peer_reviewer_verdict boolean,
  peer_reviewer_reasoning text,
  -- originating_correction_cluster_id: FK added Phase 2
  originating_correction_cluster_id uuid,
  suppressed_duplicate_count integer NOT NULL DEFAULT 0,
  occurrence_count integer NOT NULL DEFAULT 0,
  reject_reason text
    CONSTRAINT skill_amendments_reject_reason_ck
      CHECK (reject_reason IS NULL OR reject_reason IN ('incorrect_root_cause','redundant','unsafe','other')),
  rejected_at timestamptz,
  rejected_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  retired_at timestamptz,
  retirement_reason text
    CONSTRAINT skill_amendments_retirement_reason_ck
      CHECK (retirement_reason IS NULL OR retirement_reason IN ('graceful','rollback','stale','superseded','baseline_reset')),
  incident_severity text
    CONSTRAINT skill_amendments_incident_severity_ck
      CHECK (incident_severity IS NULL OR incident_severity IN ('sev1','sev2')),
  activated_at timestamptz,
  activated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotency: at most one amendment per scorecard_judgement_id while non-retired
CREATE UNIQUE INDEX IF NOT EXISTS skill_amendments_judgement_uniq
  ON skill_amendments (scorecard_judgement_id)
  WHERE status != 'retired';

CREATE INDEX IF NOT EXISTS skill_amendments_pending_idx
  ON skill_amendments (org_id, subaccount_id, status, system_skill_id, org_skill_id);

ALTER TABLE skill_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_amendments FORCE ROW LEVEL SECURITY;
CREATE POLICY skill_amendments_org_isolation ON skill_amendments USING (org_id = current_setting('app.organisation_id')::uuid) WITH CHECK (org_id = current_setting('app.organisation_id')::uuid);

-- ---------------------------------------------------------------------------
-- skill_regression_cases
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS skill_regression_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organisations(id),
  amendment_id uuid REFERENCES skill_amendments(id) ON DELETE SET NULL,
  scorecard_judgement_id uuid NOT NULL,
  tag text NOT NULL DEFAULT 'unresolved'
    CONSTRAINT skill_regression_cases_tag_ck
      CHECK (tag IN ('unresolved','fix_proposed','fix_wrong')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Partial unique: one open regression case per scorecard judgement (before a fix is linked)
CREATE UNIQUE INDEX IF NOT EXISTS skill_regression_cases_open_judgement_uniq
  ON skill_regression_cases (scorecard_judgement_id)
  WHERE amendment_id IS NULL;

ALTER TABLE skill_regression_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_regression_cases FORCE ROW LEVEL SECURITY;
CREATE POLICY skill_regression_cases_org_isolation ON skill_regression_cases USING (org_id = current_setting('app.organisation_id')::uuid) WITH CHECK (org_id = current_setting('app.organisation_id')::uuid);

-- ---------------------------------------------------------------------------
-- peer_reviewer_drops
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS peer_reviewer_drops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organisations(id),
  scorecard_judgement_id uuid NOT NULL,
  drop_reason text NOT NULL,
  peer_reviewer_model_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT peer_reviewer_drops_judgement_uniq UNIQUE (scorecard_judgement_id)
);

ALTER TABLE peer_reviewer_drops ENABLE ROW LEVEL SECURITY;
ALTER TABLE peer_reviewer_drops FORCE ROW LEVEL SECURITY;
CREATE POLICY peer_reviewer_drops_org_isolation ON peer_reviewer_drops USING (org_id = current_setting('app.organisation_id')::uuid) WITH CHECK (org_id = current_setting('app.organisation_id')::uuid);

-- ---------------------------------------------------------------------------
-- skill_amendment_effectiveness
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS skill_amendment_effectiveness (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amendment_id uuid NOT NULL REFERENCES skill_amendments(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organisations(id),
  regressions_prevented integer NOT NULL DEFAULT 0,
  subsequent_fail_rate_delta double precision,
  operator_override_frequency double precision,
  inactivity_decay_candidate boolean NOT NULL DEFAULT false,
  last_replay_run_at timestamptz,
  last_replay_verdict text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT skill_amendment_effectiveness_amendment_uniq UNIQUE (amendment_id)
);

ALTER TABLE skill_amendment_effectiveness ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_amendment_effectiveness FORCE ROW LEVEL SECURITY;
CREATE POLICY skill_amendment_effectiveness_org_isolation ON skill_amendment_effectiveness USING (org_id = current_setting('app.organisation_id')::uuid) WITH CHECK (org_id = current_setting('app.organisation_id')::uuid);

-- ---------------------------------------------------------------------------
-- amendment_proposer_metrics
-- system-scoped: per-proposer-model-version quality telemetry, never tenant-bound (§7.5 + §14)
-- NO RLS on this table.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS amendment_proposer_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposer_model_version text NOT NULL,
  period_start date NOT NULL,
  proposal_count integer NOT NULL DEFAULT 0,
  peer_review_drop_count integer NOT NULL DEFAULT 0,
  reject_count integer NOT NULL DEFAULT 0,
  rollback_count integer NOT NULL DEFAULT 0,
  regression_failure_after_accept_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amendment_proposer_metrics_model_period_uniq UNIQUE (proposer_model_version, period_start)
);

-- ---------------------------------------------------------------------------
-- amendment_proposer_entropy
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS amendment_proposer_entropy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organisations(id),
  -- skill_id as text to accommodate both system and org skill slugs
  skill_id text NOT NULL,
  period_month date NOT NULL,
  template_repetition_rate double precision,
  lexical_diversity double precision,
  remedy_category_distribution jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amendment_proposer_entropy_org_skill_month_uniq UNIQUE (org_id, skill_id, period_month)
);

ALTER TABLE amendment_proposer_entropy ENABLE ROW LEVEL SECURITY;
ALTER TABLE amendment_proposer_entropy FORCE ROW LEVEL SECURITY;
CREATE POLICY amendment_proposer_entropy_org_isolation ON amendment_proposer_entropy USING (org_id = current_setting('app.organisation_id')::uuid) WITH CHECK (org_id = current_setting('app.organisation_id')::uuid);

-- ---------------------------------------------------------------------------
-- skill_amendment_run_snapshot
-- UNIQUE NULLS NOT DISTINCT requires PostgreSQL 15+.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS skill_amendment_run_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organisations(id),
  system_skill_id uuid REFERENCES system_skills(id) ON DELETE SET NULL,
  org_skill_id uuid REFERENCES skills(id) ON DELETE SET NULL,
  resolver_version text NOT NULL,
  amendment_version_set_hash text NOT NULL,
  composed_body text NOT NULL,
  composed_body_hash text NOT NULL,
  included_amendment_ids uuid[] NOT NULL DEFAULT '{}',
  excluded_amendment_ids uuid[] NOT NULL DEFAULT '{}',
  composed_size_chars integer NOT NULL,
  truncated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One snapshot per (run, skill) — NULLS NOT DISTINCT handles rows where one skill id is NULL.
-- Requires PostgreSQL 15+.
CREATE UNIQUE INDEX IF NOT EXISTS skill_amendment_run_snapshot_run_skill_uniq
  ON skill_amendment_run_snapshot (run_id, system_skill_id, org_skill_id) NULLS NOT DISTINCT;

ALTER TABLE skill_amendment_run_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_amendment_run_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY skill_amendment_run_snapshot_org_isolation ON skill_amendment_run_snapshot USING (org_id = current_setting('app.organisation_id')::uuid) WITH CHECK (org_id = current_setting('app.organisation_id')::uuid);

-- ---------------------------------------------------------------------------
-- skill_amendment_freezes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS skill_amendment_freezes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organisations(id),
  -- nullable: org-level freezes have NULL subaccount_id
  subaccount_id uuid REFERENCES subaccounts(id) ON DELETE CASCADE,
  scope text NOT NULL
    CONSTRAINT skill_amendment_freezes_scope_ck
      CHECK (scope IN ('org','subaccount','skill')),
  -- nullable: scope='org' rows have NULL scope_id
  scope_id uuid,
  freeze_type text NOT NULL
    CONSTRAINT skill_amendment_freezes_freeze_type_ck
      CHECK (freeze_type IN ('proposal_generation','amendment_activation','review_required')),
  reason text NOT NULL,
  -- nullable: system freezes have NULL created_by_user_id
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  -- active while thawed_at IS NULL
  thawed_at timestamptz,
  thawed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- At most one active freeze per (org, scope, scope_id, freeze_type).
-- NULLS NOT DISTINCT handles org-level rows where scope_id IS NULL.
-- Requires PostgreSQL 15+.
CREATE UNIQUE INDEX IF NOT EXISTS skill_amendment_freezes_active_uniq
  ON skill_amendment_freezes (org_id, scope, scope_id, freeze_type) NULLS NOT DISTINCT
  WHERE thawed_at IS NULL;

ALTER TABLE skill_amendment_freezes ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_amendment_freezes FORCE ROW LEVEL SECURITY;
CREATE POLICY skill_amendment_freezes_org_isolation ON skill_amendment_freezes USING (org_id = current_setting('app.organisation_id')::uuid) WITH CHECK (org_id = current_setting('app.organisation_id')::uuid);
