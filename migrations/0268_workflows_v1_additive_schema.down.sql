-- Reverse of 0268_workflows_v1_additive_schema.sql (inverse order)

-- ── workflow_drafts ──
DROP TABLE IF EXISTS workflow_drafts;

-- ── workflow_step_reviews (remove added columns) ──
DROP INDEX IF EXISTS workflow_step_reviews_gate_user_uniq_idx;
ALTER TABLE workflow_step_reviews
  DROP COLUMN IF EXISTS gate_id,
  DROP COLUMN IF EXISTS decision_reason;

-- ── workflow_step_gates ──
DROP TABLE IF EXISTS workflow_step_gates;

-- ── tasks ──
ALTER TABLE tasks
  DROP COLUMN IF EXISTS next_event_seq;

-- ── agent_execution_events ──
DROP INDEX IF EXISTS agent_execution_events_run_task_seq_idx;
DROP INDEX IF EXISTS agent_execution_events_task_seq_idx;
ALTER TABLE agent_execution_events
  DROP COLUMN IF EXISTS event_schema_version,
  DROP COLUMN IF EXISTS event_subsequence,
  DROP COLUMN IF EXISTS event_origin,
  DROP COLUMN IF EXISTS task_sequence,
  DROP COLUMN IF EXISTS task_id;

-- ── scheduled_tasks ──
DROP INDEX IF EXISTS scheduled_tasks_pinned_template_version_idx;
ALTER TABLE scheduled_tasks
  DROP COLUMN IF EXISTS pinned_template_version_id;

-- ── workflow_runs ──
DROP INDEX IF EXISTS workflow_runs_status_updated_idx;
DROP INDEX IF EXISTS workflow_runs_status_paused_idx;
ALTER TABLE workflow_runs
  DROP COLUMN IF EXISTS degradation_reason,
  DROP COLUMN IF EXISTS cost_accumulator_cents,
  DROP COLUMN IF EXISTS extension_count,
  DROP COLUMN IF EXISTS effective_wall_clock_cap_seconds,
  DROP COLUMN IF EXISTS effective_cost_ceiling_cents;

-- ── workflow_templates ──
ALTER TABLE workflow_templates
  DROP COLUMN IF EXISTS wall_clock_cap_seconds,
  DROP COLUMN IF EXISTS cost_ceiling_cents;

-- ── workflow_template_versions ──
ALTER TABLE workflow_template_versions
  DROP COLUMN IF EXISTS publish_notes;
