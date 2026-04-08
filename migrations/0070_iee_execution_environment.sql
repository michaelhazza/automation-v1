-- =============================================================================
-- IEE — Integrated Execution Environment
-- Spec: docs/iee-development-spec.md (rev 7), Parts 2, 11.7, 13.1, 13.2, 13.3
--
-- Adds:
--   1. iee_runs        — one row per IEE job (browser_task | dev_task)
--   2. iee_steps       — one row per loop iteration
--   3. iee_artifacts   — file metadata for downloads/writes/logs
--   4. llm_requests    — adds iee_run_id, call_site columns + CHECK + index
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- iee_runs
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS iee_runs (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id             UUID REFERENCES agent_runs(id),
  organisation_id          UUID NOT NULL REFERENCES organisations(id),
  subaccount_id            UUID REFERENCES subaccounts(id),
  agent_id                 UUID NOT NULL REFERENCES agents(id),

  type                     TEXT NOT NULL,                 -- 'browser' | 'dev'
  mode                     TEXT NOT NULL,                 -- 'api' | 'browser' | 'dev'
  status                   TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'running' | 'completed' | 'failed'

  idempotency_key          TEXT NOT NULL,
  correlation_id           TEXT NOT NULL,

  goal                     TEXT NOT NULL,
  task                     JSONB NOT NULL,

  worker_instance_id       TEXT,
  last_heartbeat_at        TIMESTAMPTZ,

  started_at               TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,

  failure_reason           TEXT,
  result_summary           JSONB,
  step_count               INTEGER NOT NULL DEFAULT 0,

  -- Cost (cents-based to match llm_requests / cost_aggregates / budget_reservations)
  llm_cost_cents           INTEGER NOT NULL DEFAULT 0,
  llm_call_count           INTEGER NOT NULL DEFAULT 0,
  runtime_wall_ms          INTEGER,
  runtime_cpu_ms           INTEGER,
  runtime_peak_rss_bytes   BIGINT,
  runtime_cost_cents       INTEGER NOT NULL DEFAULT 0,
  total_cost_cents         INTEGER NOT NULL DEFAULT 0,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at               TIMESTAMPTZ
);

-- §2.2 — DB-level idempotency (partial so soft-delete allows reinsert)
CREATE UNIQUE INDEX IF NOT EXISTS iee_runs_idempotency_key_unique_idx
  ON iee_runs (idempotency_key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS iee_runs_org_status_idx     ON iee_runs (organisation_id, status);
CREATE INDEX IF NOT EXISTS iee_runs_org_created_idx    ON iee_runs (organisation_id, created_at);
CREATE INDEX IF NOT EXISTS iee_runs_agent_idx          ON iee_runs (agent_id);
CREATE INDEX IF NOT EXISTS iee_runs_agent_run_idx      ON iee_runs (agent_run_id);
CREATE INDEX IF NOT EXISTS iee_runs_correlation_idx    ON iee_runs (correlation_id);
CREATE INDEX IF NOT EXISTS iee_runs_subaccount_idx     ON iee_runs (subaccount_id);
-- §13.3 — heartbeat reconciliation scan
CREATE INDEX IF NOT EXISTS iee_runs_heartbeat_idx      ON iee_runs (status, last_heartbeat_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- iee_steps
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS iee_steps (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  iee_run_id        UUID NOT NULL REFERENCES iee_runs(id) ON DELETE CASCADE,
  organisation_id   UUID NOT NULL REFERENCES organisations(id),

  step_number       INTEGER NOT NULL,
  action_type       TEXT NOT NULL,
  input             JSONB NOT NULL,
  output            JSONB,
  success           BOOLEAN NOT NULL,
  failure_reason    TEXT,
  duration_ms       INTEGER,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevents duplicate step writes if the worker retries
CREATE UNIQUE INDEX IF NOT EXISTS iee_steps_run_step_unique_idx
  ON iee_steps (iee_run_id, step_number);
CREATE INDEX IF NOT EXISTS iee_steps_org_created_idx ON iee_steps (organisation_id, created_at);
CREATE INDEX IF NOT EXISTS iee_steps_run_idx         ON iee_steps (iee_run_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- iee_artifacts
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS iee_artifacts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  iee_run_id        UUID NOT NULL REFERENCES iee_runs(id) ON DELETE CASCADE,
  organisation_id   UUID NOT NULL REFERENCES organisations(id),

  kind              TEXT NOT NULL,                 -- 'download' | 'file' | 'log'
  path              TEXT NOT NULL,
  size_bytes        BIGINT,
  mime_type         TEXT,
  metadata          JSONB,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS iee_artifacts_run_idx         ON iee_artifacts (iee_run_id);
CREATE INDEX IF NOT EXISTS iee_artifacts_org_created_idx ON iee_artifacts (organisation_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- llm_requests — IEE attribution columns
-- §13.1: every IEE-tagged llm_requests row MUST carry an iee_run_id.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE llm_requests
  ADD COLUMN IF NOT EXISTS iee_run_id UUID REFERENCES iee_runs(id);

ALTER TABLE llm_requests
  ADD COLUMN IF NOT EXISTS call_site TEXT NOT NULL DEFAULT 'app';

-- Belt-and-braces invariant: even if a future code path forgets the router
-- guard, the database refuses to insert an IEE-tagged row without an ieeRunId.
ALTER TABLE llm_requests
  DROP CONSTRAINT IF EXISTS llm_requests_iee_requires_run_id;
ALTER TABLE llm_requests
  ADD CONSTRAINT llm_requests_iee_requires_run_id
  CHECK (source_type <> 'iee' OR iee_run_id IS NOT NULL);

-- Partial index — only IEE rows pay the cost
CREATE INDEX IF NOT EXISTS llm_requests_iee_run_id_idx
  ON llm_requests (iee_run_id)
  WHERE iee_run_id IS NOT NULL;
