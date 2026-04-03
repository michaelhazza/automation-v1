-- Migration 0048: Data integrity constraints
-- Fixes from PR review: CHECK constraints, scheduling dedupe, scope enforcement.

-- =============================================================================
-- 1. CHECK constraints for execution_scope ↔ subaccount_id consistency
-- =============================================================================

-- Agent runs: scope must match presence of subaccount_id
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_scope_check CHECK (
  (execution_scope = 'org' AND subaccount_id IS NULL AND subaccount_agent_id IS NULL)
  OR
  (execution_scope = 'subaccount' AND subaccount_id IS NOT NULL)
);

-- =============================================================================
-- 2. Enum CHECK constraints on text columns
-- =============================================================================

-- agent_runs.execution_scope
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_execution_scope_enum
  CHECK (execution_scope IN ('org', 'subaccount'));

-- agent_runs.run_result_status
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_run_result_status_enum
  CHECK (run_result_status IS NULL OR run_result_status IN ('success', 'partial', 'failed'));

-- actions.action_scope
ALTER TABLE actions ADD CONSTRAINT actions_action_scope_enum
  CHECK (action_scope IN ('org', 'subaccount'));

-- system_agents.execution_scope
ALTER TABLE system_agents ADD CONSTRAINT system_agents_execution_scope_enum
  CHECK (execution_scope IN ('org', 'subaccount'));

-- connector_configs.sync_phase
ALTER TABLE connector_configs ADD CONSTRAINT connector_configs_sync_phase_enum
  CHECK (sync_phase IN ('backfill', 'transition', 'live'));

-- connector_configs.status
ALTER TABLE connector_configs ADD CONSTRAINT connector_configs_status_enum
  CHECK (status IN ('active', 'error', 'disconnected'));

-- =============================================================================
-- 3. Scheduling dedupe: unique constraint per execution window
-- Prevents the same org agent from running twice in the same schedule tick.
-- =============================================================================

-- Add a composite unique index that pg-boss can use for dedupe.
-- The idempotency_key on agent_runs already has a unique index, but we need
-- to ensure scheduled runs generate deterministic keys per tick.
-- This is enforced at the application layer via idempotency keys that include
-- the schedule tick timestamp (floor to interval). No additional DB constraint
-- needed here — the existing agent_runs.idempotency_key unique index handles it.

-- However, add an advisory lock column hint for documentation:
COMMENT ON COLUMN org_agent_configs.schedule_cron IS
  'Cron expression for scheduled runs. Execution uses pg-boss schedule with dedupe key: agent-org-scheduled-run:{configId}. pg-boss ensures single execution per schedule tick.';

-- =============================================================================
-- 4. Additional indexes identified in review
-- =============================================================================

CREATE INDEX IF NOT EXISTS agent_runs_org_created_idx
  ON agent_runs (organisation_id, created_at DESC);
