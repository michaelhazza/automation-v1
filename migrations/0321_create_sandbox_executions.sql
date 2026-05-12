-- Migration 0321: Create sandbox_executions table
-- Spec §20.3. One row per sandbox task execution. Includes F3 start-claim lease
-- columns (provider_sandbox_id, start_claimed_at, start_claim_expires_at,
-- start_attempt_count) for idempotent provider-start semantics (spec §8.1).

CREATE TABLE sandbox_executions (
  id                        UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organisation_id           UUID         NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  subaccount_id             UUID         NOT NULL,
  run_id                    UUID         NOT NULL,
  agent_id                  UUID         NOT NULL,
  task_id                   TEXT         NOT NULL,

  -- Provider info
  provider                  TEXT         NOT NULL,
  -- Set when provider start succeeds; NULL while pending.
  -- Primary correlation key for provider-webhook-driven reconciliation (spec §20.3).
  provider_sandbox_id       TEXT,
  provider_project          TEXT,

  -- Template pinning (spec §15.3)
  template_name             TEXT         NOT NULL,
  template_version          TEXT         NOT NULL,
  template_digest           TEXT,
  template_build_commit     TEXT,

  -- State machine — closed enum from spec §13.1 enforced by CHECK constraint below
  status                    TEXT         NOT NULL DEFAULT 'pending',

  -- Policy snapshot at run start (spec §20.1)
  policy_json               JSONB        NOT NULL,

  -- Input summary: size + MIME + file count; no content (spec §20.1)
  input_summary_json        JSONB,

  -- Harvest outputs — populated on terminal
  output_json               JSONB,
  metrics_json              JSONB,
  cost_cents                INTEGER,
  error_reason              TEXT,
  error_detail              TEXT,

  -- Attempt tracking for crash retries (spec §13.2)
  attempt_number            INTEGER      NOT NULL DEFAULT 1,

  -- F3 start-claim lease columns (spec §8.1)
  start_claimed_at          TIMESTAMPTZ,
  start_claim_expires_at    TIMESTAMPTZ,
  start_attempt_count       INTEGER      NOT NULL DEFAULT 0,

  -- Soft-delete flag (spec §17.4)
  is_active                 BOOLEAN      NOT NULL DEFAULT TRUE,

  -- Timestamps
  started_at                TIMESTAMPTZ,
  terminated_at             TIMESTAMPTZ,
  harvested_at              TIMESTAMPTZ,
  created_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- CHECK constraints (spec §20.3)
  CONSTRAINT sandbox_executions_status_valid CHECK (status IN (
    'pending', 'running', 'harvesting',
    'completed', 'timed_out', 'cost_ceiling_hit', 'crashed',
    'output_validation_failed', 'harvest_failed', 'artefact_upload_failed',
    'provider_unavailable'
  )),
  CONSTRAINT sandbox_executions_provider_sandbox_id_not_pending CHECK (
    provider_sandbox_id IS NULL OR status <> 'pending'
  ),
  CONSTRAINT sandbox_executions_running_harvesting_needs_provider_id CHECK (
    status NOT IN ('running', 'harvesting') OR provider_sandbox_id IS NOT NULL
  ),
  CONSTRAINT sandbox_executions_start_attempt_count_non_negative CHECK (
    start_attempt_count >= 0
  )
);

-- Indexes (spec §20.3)
CREATE INDEX sandbox_executions_org_started_at_idx ON sandbox_executions (organisation_id, started_at DESC);
CREATE INDEX sandbox_executions_subaccount_started_at_idx ON sandbox_executions (subaccount_id, started_at DESC);
CREATE INDEX sandbox_executions_run_id_idx ON sandbox_executions (run_id);
-- Partial index for reconciliation queries — only non-terminal rows pay the index cost
CREATE INDEX sandbox_executions_status_pending_idx ON sandbox_executions (status)
  WHERE status IN ('pending', 'running', 'harvesting');
-- Partial index for provider-webhook-driven reconciliation lookups
CREATE INDEX sandbox_executions_provider_sandbox_id_idx ON sandbox_executions (provider_sandbox_id)
  WHERE provider_sandbox_id IS NOT NULL;

-- RLS (spec §20.3, §21.1): organisation-boundary enforced at policy layer;
-- subaccount filtering enforced at service layer.
ALTER TABLE sandbox_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sandbox_executions FORCE ROW LEVEL SECURITY;
CREATE POLICY sandbox_executions_org_isolation ON sandbox_executions
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
