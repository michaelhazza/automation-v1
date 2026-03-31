-- =============================================================================
-- 0033_timezone_standardisation.sql
-- M-1: Standardise ALL timestamps to timestamptz (timestamp with time zone).
--
-- All previously stored timestamps are assumed UTC (the application never
-- stored non-UTC values). The USING clause interprets stored values as UTC
-- and attaches the timezone annotation without altering the stored instant.
--
-- Tables already using timestamptz are skipped:
--   llm_requests, budget_reservations, cost_aggregates, llm_pricing,
--   org_budgets, org_margin_configs, workspace_entities, agent_triggers
-- =============================================================================

-- organisations
ALTER TABLE "organisations"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';

-- users
ALTER TABLE "users"
  ALTER COLUMN "invite_expires_at"          TYPE timestamptz USING "invite_expires_at"          AT TIME ZONE 'UTC',
  ALTER COLUMN "password_reset_expires_at"  TYPE timestamptz USING "password_reset_expires_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "last_login_at"              TYPE timestamptz USING "last_login_at"              AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at"                TYPE timestamptz USING "created_at"                AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"                TYPE timestamptz USING "updated_at"                AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at"                TYPE timestamptz USING "deleted_at"                AT TIME ZONE 'UTC';

-- subaccounts
ALTER TABLE "subaccounts"
  ALTER COLUMN "created_at"  TYPE timestamptz USING "created_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"  TYPE timestamptz USING "updated_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at"  TYPE timestamptz USING "deleted_at"  AT TIME ZONE 'UTC';

-- agents
ALTER TABLE "agents"
  ALTER COLUMN "created_at"  TYPE timestamptz USING "created_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"  TYPE timestamptz USING "updated_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at"  TYPE timestamptz USING "deleted_at"  AT TIME ZONE 'UTC';

-- system_agents
ALTER TABLE "system_agents"
  ALTER COLUMN "created_at"  TYPE timestamptz USING "created_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"  TYPE timestamptz USING "updated_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at"  TYPE timestamptz USING "deleted_at"  AT TIME ZONE 'UTC';

-- agent_data_sources
ALTER TABLE "agent_data_sources"
  ALTER COLUMN "last_fetched_at"   TYPE timestamptz USING "last_fetched_at"   AT TIME ZONE 'UTC',
  ALTER COLUMN "last_alert_sent_at" TYPE timestamptz USING "last_alert_sent_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at"        TYPE timestamptz USING "created_at"        AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"        TYPE timestamptz USING "updated_at"        AT TIME ZONE 'UTC';

-- agent_conversations
ALTER TABLE "agent_conversations"
  ALTER COLUMN "created_at"  TYPE timestamptz USING "created_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"  TYPE timestamptz USING "updated_at"  AT TIME ZONE 'UTC';

-- agent_messages
ALTER TABLE "agent_messages"
  ALTER COLUMN "created_at"  TYPE timestamptz USING "created_at"  AT TIME ZONE 'UTC';

-- agent_runs
ALTER TABLE "agent_runs"
  ALTER COLUMN "started_at"    TYPE timestamptz USING "started_at"    AT TIME ZONE 'UTC',
  ALTER COLUMN "completed_at"  TYPE timestamptz USING "completed_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at"    TYPE timestamptz USING "created_at"    AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"    TYPE timestamptz USING "updated_at"    AT TIME ZONE 'UTC';

-- agent_templates (deprecated)
ALTER TABLE "agent_templates"
  ALTER COLUMN "created_at"  TYPE timestamptz USING "created_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"  TYPE timestamptz USING "updated_at"  AT TIME ZONE 'UTC';

-- skills
ALTER TABLE "skills"
  ALTER COLUMN "created_at"  TYPE timestamptz USING "created_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"  TYPE timestamptz USING "updated_at"  AT TIME ZONE 'UTC';

-- system_skills
ALTER TABLE "system_skills"
  ALTER COLUMN "created_at"  TYPE timestamptz USING "created_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"  TYPE timestamptz USING "updated_at"  AT TIME ZONE 'UTC';

-- board_configs
ALTER TABLE "board_configs"
  ALTER COLUMN "created_at"  TYPE timestamptz USING "created_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"  TYPE timestamptz USING "updated_at"  AT TIME ZONE 'UTC';

-- board_templates
ALTER TABLE "board_templates"
  ALTER COLUMN "created_at"  TYPE timestamptz USING "created_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"  TYPE timestamptz USING "updated_at"  AT TIME ZONE 'UTC';

-- subaccount_agents
ALTER TABLE "subaccount_agents"
  ALTER COLUMN "last_run_at"   TYPE timestamptz USING "last_run_at"   AT TIME ZONE 'UTC',
  ALTER COLUMN "next_run_at"   TYPE timestamptz USING "next_run_at"   AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at"    TYPE timestamptz USING "created_at"    AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"    TYPE timestamptz USING "updated_at"    AT TIME ZONE 'UTC';

-- tasks
ALTER TABLE "tasks"
  ALTER COLUMN "due_date"     TYPE timestamptz USING "due_date"     AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at"   TYPE timestamptz USING "created_at"   AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"   TYPE timestamptz USING "updated_at"   AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at"   TYPE timestamptz USING "deleted_at"   AT TIME ZONE 'UTC';

-- task_activities
ALTER TABLE "task_activities"
  ALTER COLUMN "created_at"  TYPE timestamptz USING "created_at"  AT TIME ZONE 'UTC';

-- task_deliverables
ALTER TABLE "task_deliverables"
  ALTER COLUMN "created_at"  TYPE timestamptz USING "created_at"  AT TIME ZONE 'UTC';

-- workspace_memories
ALTER TABLE "workspace_memories"
  ALTER COLUMN "summary_generated_at"  TYPE timestamptz USING "summary_generated_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at"            TYPE timestamptz USING "created_at"            AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"            TYPE timestamptz USING "updated_at"            AT TIME ZONE 'UTC';

-- workspace_memory_entries (embedding column already exists, don't touch it)
ALTER TABLE "workspace_memory_entries"
  ALTER COLUMN "created_at"  TYPE timestamptz USING "created_at"  AT TIME ZONE 'UTC';

-- workflow_engines
ALTER TABLE "workflow_engines"
  ALTER COLUMN "last_tested_at"  TYPE timestamptz USING "last_tested_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at"      TYPE timestamptz USING "created_at"      AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"      TYPE timestamptz USING "updated_at"      AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at"      TYPE timestamptz USING "deleted_at"      AT TIME ZONE 'UTC';

-- workspace_limits
ALTER TABLE "workspace_limits"
  ALTER COLUMN "created_at"  TYPE timestamptz USING "created_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"  TYPE timestamptz USING "updated_at"  AT TIME ZONE 'UTC';

-- scheduled_tasks
ALTER TABLE "scheduled_tasks"
  ALTER COLUMN "next_run_at"   TYPE timestamptz USING "next_run_at"   AT TIME ZONE 'UTC',
  ALTER COLUMN "last_run_at"   TYPE timestamptz USING "last_run_at"   AT TIME ZONE 'UTC',
  ALTER COLUMN "ends_at"       TYPE timestamptz USING "ends_at"       AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at"    TYPE timestamptz USING "created_at"    AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"    TYPE timestamptz USING "updated_at"    AT TIME ZONE 'UTC';

-- scheduled_task_runs
ALTER TABLE "scheduled_task_runs"
  ALTER COLUMN "scheduled_for"  TYPE timestamptz USING "scheduled_for"  AT TIME ZONE 'UTC',
  ALTER COLUMN "started_at"     TYPE timestamptz USING "started_at"     AT TIME ZONE 'UTC',
  ALTER COLUMN "completed_at"   TYPE timestamptz USING "completed_at"   AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at"     TYPE timestamptz USING "created_at"     AT TIME ZONE 'UTC';

-- actions
ALTER TABLE "actions"
  ALTER COLUMN "approved_at"   TYPE timestamptz USING "approved_at"   AT TIME ZONE 'UTC',
  ALTER COLUMN "executed_at"   TYPE timestamptz USING "executed_at"   AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at"    TYPE timestamptz USING "created_at"    AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"    TYPE timestamptz USING "updated_at"    AT TIME ZONE 'UTC';

-- action_events
ALTER TABLE "action_events"
  ALTER COLUMN "created_at"  TYPE timestamptz USING "created_at"  AT TIME ZONE 'UTC';

-- review_items
ALTER TABLE "review_items"
  ALTER COLUMN "reviewed_at"  TYPE timestamptz USING "reviewed_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at"   TYPE timestamptz USING "created_at"   AT TIME ZONE 'UTC';

-- integration_connections
ALTER TABLE "integration_connections"
  ALTER COLUMN "token_expires_at"   TYPE timestamptz USING "token_expires_at"   AT TIME ZONE 'UTC',
  ALTER COLUMN "last_verified_at"   TYPE timestamptz USING "last_verified_at"   AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at"         TYPE timestamptz USING "created_at"         AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"         TYPE timestamptz USING "updated_at"         AT TIME ZONE 'UTC';

-- process_connection_mappings
ALTER TABLE "process_connection_mappings"
  ALTER COLUMN "created_at"  TYPE timestamptz USING "created_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"  TYPE timestamptz USING "updated_at"  AT TIME ZONE 'UTC';

-- subaccount_process_links
ALTER TABLE "subaccount_process_links"
  ALTER COLUMN "created_at"  TYPE timestamptz USING "created_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"  TYPE timestamptz USING "updated_at"  AT TIME ZONE 'UTC';

-- process_categories
ALTER TABLE "process_categories"
  ALTER COLUMN "created_at"   TYPE timestamptz USING "created_at"   AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"   TYPE timestamptz USING "updated_at"   AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at"   TYPE timestamptz USING "deleted_at"   AT TIME ZONE 'UTC';

-- subaccount_categories
ALTER TABLE "subaccount_categories"
  ALTER COLUMN "created_at"  TYPE timestamptz USING "created_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"  TYPE timestamptz USING "updated_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at"  TYPE timestamptz USING "deleted_at"  AT TIME ZONE 'UTC';

-- hierarchy_templates
ALTER TABLE "hierarchy_templates"
  ALTER COLUMN "created_at"  TYPE timestamptz USING "created_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"  TYPE timestamptz USING "updated_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at"  TYPE timestamptz USING "deleted_at"  AT TIME ZONE 'UTC';

-- hierarchy_template_slots
ALTER TABLE "hierarchy_template_slots"
  ALTER COLUMN "created_at"  TYPE timestamptz USING "created_at"  AT TIME ZONE 'UTC';

-- system_hierarchy_templates
ALTER TABLE "system_hierarchy_templates"
  ALTER COLUMN "created_at"  TYPE timestamptz USING "created_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"  TYPE timestamptz USING "updated_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at"  TYPE timestamptz USING "deleted_at"  AT TIME ZONE 'UTC';

-- system_hierarchy_template_slots
ALTER TABLE "system_hierarchy_template_slots"
  ALTER COLUMN "created_at"  TYPE timestamptz USING "created_at"  AT TIME ZONE 'UTC';

-- permission_sets
ALTER TABLE "permission_sets"
  ALTER COLUMN "created_at"  TYPE timestamptz USING "created_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"  TYPE timestamptz USING "updated_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at"  TYPE timestamptz USING "deleted_at"  AT TIME ZONE 'UTC';

-- permission_set_items
ALTER TABLE "permission_set_items"
  ALTER COLUMN "created_at"  TYPE timestamptz USING "created_at"  AT TIME ZONE 'UTC';

-- permissions
ALTER TABLE "permissions"
  ALTER COLUMN "created_at"  TYPE timestamptz USING "created_at"  AT TIME ZONE 'UTC';

-- org_user_roles
ALTER TABLE "org_user_roles"
  ALTER COLUMN "created_at"  TYPE timestamptz USING "created_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"  TYPE timestamptz USING "updated_at"  AT TIME ZONE 'UTC';

-- subaccount_user_assignments
ALTER TABLE "subaccount_user_assignments"
  ALTER COLUMN "created_at"  TYPE timestamptz USING "created_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"  TYPE timestamptz USING "updated_at"  AT TIME ZONE 'UTC';

-- processes
ALTER TABLE "processes"
  ALTER COLUMN "created_at"  TYPE timestamptz USING "created_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"  TYPE timestamptz USING "updated_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at"  TYPE timestamptz USING "deleted_at"  AT TIME ZONE 'UTC';

-- executions
ALTER TABLE "executions"
  ALTER COLUMN "callback_received_at"  TYPE timestamptz USING "callback_received_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "queued_at"             TYPE timestamptz USING "queued_at"             AT TIME ZONE 'UTC',
  ALTER COLUMN "started_at"            TYPE timestamptz USING "started_at"            AT TIME ZONE 'UTC',
  ALTER COLUMN "completed_at"          TYPE timestamptz USING "completed_at"          AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at"            TYPE timestamptz USING "created_at"            AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"            TYPE timestamptz USING "updated_at"            AT TIME ZONE 'UTC';

-- execution_files
ALTER TABLE "execution_files"
  ALTER COLUMN "expires_at"   TYPE timestamptz USING "expires_at"   AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at"   TYPE timestamptz USING "created_at"   AT TIME ZONE 'UTC';

-- processed_resources
ALTER TABLE "processed_resources"
  ALTER COLUMN "first_seen_at"   TYPE timestamptz USING "first_seen_at"   AT TIME ZONE 'UTC',
  ALTER COLUMN "processed_at"    TYPE timestamptz USING "processed_at"    AT TIME ZONE 'UTC';

-- projects
ALTER TABLE "projects"
  ALTER COLUMN "created_at"  TYPE timestamptz USING "created_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at"  TYPE timestamptz USING "updated_at"  AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at"  TYPE timestamptz USING "deleted_at"  AT TIME ZONE 'UTC';

-- system_settings
ALTER TABLE "system_settings"
  ALTER COLUMN "updated_at"  TYPE timestamptz USING "updated_at"  AT TIME ZONE 'UTC';
