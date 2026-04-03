-- Migration 0043: Org-level agent execution foundation
-- Enables agents to run at the organisation level without a subaccount binding.
-- Part of Phase 1: Org-Level Agent Execution (Foundation)

-- =============================================================================
-- 1. Agent Runs: Make subaccountId/subaccountAgentId nullable, add org columns
-- =============================================================================

ALTER TABLE agent_runs ALTER COLUMN subaccount_id DROP NOT NULL;
ALTER TABLE agent_runs ALTER COLUMN subaccount_agent_id DROP NOT NULL;

-- Explicit execution scope (never inferred from nullable fields)
ALTER TABLE agent_runs ADD COLUMN execution_scope text NOT NULL DEFAULT 'subaccount';

-- Run result classification
ALTER TABLE agent_runs ADD COLUMN run_result_status text;

-- Config snapshot for reproducibility and drift detection
ALTER TABLE agent_runs ADD COLUMN config_snapshot jsonb;
ALTER TABLE agent_runs ADD COLUMN config_hash text;
ALTER TABLE agent_runs ADD COLUMN resolved_skill_slugs jsonb;
ALTER TABLE agent_runs ADD COLUMN resolved_limits jsonb;

-- Backfill existing rows
UPDATE agent_runs SET execution_scope = 'subaccount' WHERE execution_scope IS NULL;

-- org_status_idx already exists; add execution_scope index for filtering
CREATE INDEX IF NOT EXISTS agent_runs_execution_scope_idx ON agent_runs (organisation_id, execution_scope, status);

-- =============================================================================
-- 2. Review Items: Make subaccountId nullable, add org-level query index
-- =============================================================================

ALTER TABLE review_items ALTER COLUMN subaccount_id DROP NOT NULL;

-- Composite index for org-level review queue queries
CREATE INDEX IF NOT EXISTS review_items_org_status_idx ON review_items (organisation_id, review_status);

-- =============================================================================
-- 3. Actions: Make subaccountId nullable, add action_scope, fix idempotency
-- =============================================================================

ALTER TABLE actions ALTER COLUMN subaccount_id DROP NOT NULL;

-- Explicit action scope for idempotency separation
ALTER TABLE actions ADD COLUMN action_scope text NOT NULL DEFAULT 'subaccount';

-- Backfill existing rows
UPDATE actions SET action_scope = 'subaccount' WHERE action_scope IS NULL;

-- The existing idempotency constraint is on (subaccount_id, idempotency_key).
-- For org-level actions where subaccount_id IS NULL, PostgreSQL unique constraints
-- don't catch duplicates (NULL != NULL). Add a partial unique index for org scope.
CREATE UNIQUE INDEX IF NOT EXISTS actions_org_idempotency_idx
  ON actions (organisation_id, idempotency_key)
  WHERE action_scope = 'org';

-- Org-level actions status index
CREATE INDEX IF NOT EXISTS actions_org_status_idx ON actions (organisation_id, status)
  WHERE action_scope = 'org';

-- =============================================================================
-- 4. System Agents: Add execution scope for org vs subaccount targeting
-- =============================================================================

ALTER TABLE system_agents ADD COLUMN execution_scope text NOT NULL DEFAULT 'subaccount';

-- =============================================================================
-- 5. Organisations: Add org-level execution kill switch
-- =============================================================================

ALTER TABLE organisations ADD COLUMN org_execution_enabled boolean NOT NULL DEFAULT true;

-- =============================================================================
-- 6. Org Agent Configs: New table for org-level agent deployment configuration
-- =============================================================================

CREATE TABLE org_agent_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  agent_id uuid NOT NULL REFERENCES agents(id),
  is_active boolean NOT NULL DEFAULT true,

  -- Execution limits
  token_budget_per_run integer NOT NULL DEFAULT 30000,
  max_tool_calls_per_run integer NOT NULL DEFAULT 20,
  timeout_seconds integer NOT NULL DEFAULT 300,
  max_cost_per_run_cents integer,
  max_llm_calls_per_run integer,

  -- Skill configuration
  skill_slugs jsonb,
  allowed_skill_slugs jsonb,
  custom_instructions text,

  -- Heartbeat scheduling
  heartbeat_enabled boolean NOT NULL DEFAULT false,
  heartbeat_interval_hours integer NOT NULL DEFAULT 24,
  heartbeat_offset_minutes integer NOT NULL DEFAULT 0,

  -- Cron scheduling
  schedule_cron text,
  schedule_enabled boolean NOT NULL DEFAULT false,
  schedule_timezone text NOT NULL DEFAULT 'UTC',

  -- Runtime state
  last_run_at timestamptz,

  -- Cross-boundary access control
  allowed_subaccount_ids jsonb,

  -- Template tracking
  applied_template_id uuid,
  applied_template_version integer,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organisation_id, agent_id)
);

CREATE INDEX org_agent_configs_org_idx ON org_agent_configs (organisation_id);
CREATE INDEX org_agent_configs_agent_idx ON org_agent_configs (agent_id);
CREATE INDEX org_agent_configs_active_idx ON org_agent_configs (organisation_id, is_active)
  WHERE is_active = true;
CREATE INDEX org_agent_configs_schedule_idx ON org_agent_configs (schedule_enabled)
  WHERE schedule_enabled = true;
