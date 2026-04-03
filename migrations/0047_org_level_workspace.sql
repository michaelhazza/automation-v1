-- Migration 0047: Org-level workspace
-- Part of Phase 5: Makes tasks, scheduled tasks, triggers, and connections
-- available at the organisation level (nullable subaccountId).

-- =============================================================================
-- 1. Tasks: Make subaccountId nullable for org-level tasks
-- =============================================================================

ALTER TABLE tasks ALTER COLUMN subaccount_id DROP NOT NULL;

-- Partial index for org-level task queries
CREATE INDEX IF NOT EXISTS tasks_org_no_subaccount_idx
  ON tasks (organisation_id, status)
  WHERE subaccount_id IS NULL;

-- =============================================================================
-- 2. Scheduled Tasks: Make subaccountId nullable
-- =============================================================================

ALTER TABLE scheduled_tasks ALTER COLUMN subaccount_id DROP NOT NULL;

-- Partial index for org-level scheduled task queries
CREATE INDEX IF NOT EXISTS scheduled_tasks_org_no_subaccount_idx
  ON scheduled_tasks (organisation_id, is_active)
  WHERE subaccount_id IS NULL;

-- =============================================================================
-- 3. Agent Triggers: Make subaccountId and subaccountAgentId nullable
-- =============================================================================

ALTER TABLE agent_triggers ALTER COLUMN subaccount_id DROP NOT NULL;
ALTER TABLE agent_triggers ALTER COLUMN subaccount_agent_id DROP NOT NULL;

-- Add org-level event types support
-- (TypeScript type widening is handled in the schema file)

-- Partial index for org-level trigger queries
CREATE INDEX IF NOT EXISTS agent_triggers_org_no_subaccount_idx
  ON agent_triggers (organisation_id, event_type)
  WHERE subaccount_id IS NULL AND deleted_at IS NULL;

-- =============================================================================
-- 4. Integration Connections: Make subaccountId nullable for org-level connections
-- =============================================================================

ALTER TABLE integration_connections ALTER COLUMN subaccount_id DROP NOT NULL;

-- Note: The existing unique constraint on (subaccount_id, provider_type, label)
-- won't catch org-level duplicates (NULL != NULL). Add a partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS integration_connections_org_provider_unique
  ON integration_connections (organisation_id, provider_type, label)
  WHERE subaccount_id IS NULL;
