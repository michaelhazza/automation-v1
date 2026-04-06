-- Phase 5: Org-Level Workspace — make subaccountId nullable on workspace tables

-- Tasks: org-level tasks have subaccountId = NULL
ALTER TABLE tasks ALTER COLUMN subaccount_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_org_only_idx ON tasks (organisation_id, status) WHERE subaccount_id IS NULL;

-- Scheduled Tasks: org-level scheduled tasks
ALTER TABLE scheduled_tasks ALTER COLUMN subaccount_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS scheduled_tasks_org_only_idx ON scheduled_tasks (organisation_id, is_active) WHERE subaccount_id IS NULL;

-- Agent Triggers: org-level triggers
ALTER TABLE agent_triggers ALTER COLUMN subaccount_id DROP NOT NULL;
ALTER TABLE agent_triggers ALTER COLUMN subaccount_agent_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS agent_triggers_org_only_idx ON agent_triggers (organisation_id, event_type) WHERE subaccount_id IS NULL;
