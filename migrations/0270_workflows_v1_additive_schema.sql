-- Workflows V1 additive schema (spec docs/workflows-dev-spec.md §3, §18.1)
-- All columns default-safe. RLS for the two new tables in same migration.

-- ── workflow_step_reviews ──
ALTER TABLE workflow_step_reviews
  ADD COLUMN IF NOT EXISTS gate_id uuid,
  ADD COLUMN IF NOT EXISTS decision_reason text,
  ADD COLUMN IF NOT EXISTS resolution_reason text;

CREATE UNIQUE INDEX IF NOT EXISTS workflow_step_reviews_gate_user_uniq_idx
  ON workflow_step_reviews (gate_id, decided_by_user_id)
  WHERE decided_by_user_id IS NOT NULL;

-- ── workflow_template_versions ──
ALTER TABLE workflow_template_versions
  ADD COLUMN IF NOT EXISTS publish_notes text;

-- ── workflow_templates (org templates) ──
ALTER TABLE workflow_templates
  ADD COLUMN IF NOT EXISTS cost_ceiling_cents integer NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS wall_clock_cap_seconds integer NOT NULL DEFAULT 3600;

-- ── workflow_runs ──
ALTER TABLE workflow_runs
  ADD COLUMN IF NOT EXISTS effective_cost_ceiling_cents integer,
  ADD COLUMN IF NOT EXISTS effective_wall_clock_cap_seconds integer,
  ADD COLUMN IF NOT EXISTS extension_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_accumulator_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS degradation_reason text;

ALTER TABLE workflow_runs
  ADD CONSTRAINT workflow_runs_cost_accumulator_nonneg
  CHECK (cost_accumulator_cents >= 0);

CREATE INDEX IF NOT EXISTS workflow_runs_status_paused_idx
  ON workflow_runs (id)
  WHERE status = 'paused';

CREATE INDEX IF NOT EXISTS workflow_runs_status_updated_idx
  ON workflow_runs (status, updated_at DESC);

-- ── scheduled_tasks ──
ALTER TABLE scheduled_tasks
  ADD COLUMN IF NOT EXISTS pinned_template_version_id uuid REFERENCES workflow_template_versions(id);

CREATE INDEX IF NOT EXISTS scheduled_tasks_pinned_template_version_idx
  ON scheduled_tasks (pinned_template_version_id)
  WHERE pinned_template_version_id IS NOT NULL;

-- ── agent_execution_events ──
ALTER TABLE agent_execution_events
  ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES tasks(id),
  ADD COLUMN IF NOT EXISTS task_sequence bigint,
  ADD COLUMN IF NOT EXISTS event_origin text,
  ADD COLUMN IF NOT EXISTS event_subsequence integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS event_schema_version integer NOT NULL DEFAULT 1;

ALTER TABLE agent_execution_events
  ADD CONSTRAINT agent_execution_events_event_origin_enum
  CHECK (event_origin IS NULL OR event_origin IN ('engine', 'gate', 'user', 'orchestrator'));

CREATE UNIQUE INDEX IF NOT EXISTS agent_execution_events_task_seq_idx
  ON agent_execution_events (task_id, task_sequence, event_subsequence)
  WHERE task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS agent_execution_events_run_task_seq_idx
  ON agent_execution_events (run_id, task_sequence)
  WHERE task_id IS NOT NULL;

-- ── tasks ──
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS next_event_seq integer NOT NULL DEFAULT 0;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_next_event_seq_nonneg
  CHECK (next_event_seq >= 0);

-- ── workflow_step_gates (new) ──
CREATE TABLE IF NOT EXISTS workflow_step_gates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_id text NOT NULL,
  gate_kind text NOT NULL,
  seen_payload jsonb,
  seen_confidence jsonb,
  approver_pool_snapshot jsonb,
  is_critical_synthesised boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution_reason text,
  organisation_id uuid NOT NULL REFERENCES organisations(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS workflow_step_gates_run_step_uniq_idx
  ON workflow_step_gates (workflow_run_id, step_id);

CREATE INDEX IF NOT EXISTS workflow_step_gates_run_resolved_idx
  ON workflow_step_gates (workflow_run_id)
  WHERE resolved_at IS NULL;

ALTER TABLE workflow_step_gates ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_step_gates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workflow_step_gates_isolation ON workflow_step_gates;
CREATE POLICY workflow_step_gates_isolation ON workflow_step_gates
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

-- ── workflow_drafts (new) ──
CREATE TABLE IF NOT EXISTS workflow_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid NOT NULL REFERENCES subaccounts(id),
  payload jsonb NOT NULL,
  draft_source text NOT NULL DEFAULT 'orchestrator',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS workflow_drafts_subaccount_session_uniq_idx
  ON workflow_drafts (subaccount_id, session_id);

CREATE INDEX IF NOT EXISTS workflow_drafts_unconsumed_idx
  ON workflow_drafts (consumed_at, created_at)
  WHERE consumed_at IS NULL;

ALTER TABLE workflow_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_drafts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workflow_drafts_isolation ON workflow_drafts;
CREATE POLICY workflow_drafts_isolation ON workflow_drafts
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
