-- =============================================================================
-- Migration 0037: Phase 1C memory scoring columns + Phase 2 workflow tables
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. workspace_memory_entries — Mem0 scoring columns
-- ---------------------------------------------------------------------------

ALTER TABLE workspace_memory_entries
  ADD COLUMN IF NOT EXISTS access_count     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS task_slug        TEXT;           -- null = global memory

-- Index for task-scoped retrieval
CREATE INDEX IF NOT EXISTS idx_workspace_memory_entries_task_slug
  ON workspace_memory_entries (subaccount_id, task_slug)
  WHERE task_slug IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. workflow_runs — Phase 2 orchestration
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workflow_runs (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id     UUID        NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    subaccount_id       UUID        NOT NULL REFERENCES subaccounts(id)   ON DELETE CASCADE,

    -- Workflow definition (stored as JSONB so definitions evolve without schema changes)
    workflow_definition JSONB       NOT NULL,   -- WorkflowDefinition snapshot at launch time
    workflow_name       TEXT        NOT NULL,
    workflow_version    TEXT        NOT NULL DEFAULT '1.0.0',

    -- Execution state
    status              TEXT        NOT NULL DEFAULT 'running'
                        CHECK (status IN ('running', 'paused', 'completed', 'failed')),
    current_step_index  INTEGER     NOT NULL DEFAULT 0,
    step_outputs        JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- keyed by step_id

    -- Checkpoint for deterministic resume (LangGraph pattern)
    checkpoint          JSONB,      -- { step_id, input_snapshot, agent_run_id, created_at }

    -- Attribution
    triggered_by        UUID        REFERENCES users(id),
    error_message       TEXT,

    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_org ON workflow_runs (organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_subaccount ON workflow_runs (subaccount_id, status);

-- ---------------------------------------------------------------------------
-- 3. workflow_step_outputs — append-only output log per step
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workflow_step_outputs (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_run_id UUID        NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    step_id         TEXT        NOT NULL,
    step_index      INTEGER     NOT NULL,
    agent_run_id    UUID        REFERENCES agent_runs(id),
    status          TEXT        NOT NULL CHECK (status IN ('completed', 'failed', 'skipped')),
    output          JSONB,
    error_message   TEXT,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_workflow_step_outputs_run ON workflow_step_outputs (workflow_run_id, step_index);

-- ---------------------------------------------------------------------------
-- 4. review_audit_records — add workflow context columns (Phase 2 extension)
-- ---------------------------------------------------------------------------

ALTER TABLE review_audit_records
  ADD COLUMN IF NOT EXISTS workflow_run_id UUID REFERENCES workflow_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS workflow_step_id TEXT;
