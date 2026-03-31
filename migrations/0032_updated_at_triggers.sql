-- =============================================================================
-- 0032_updated_at_triggers.sql
-- H-4: Database-level updated_at auto-update triggers.
--
-- Application code cannot reliably maintain updated_at across 50 tables.
-- A single trigger function handles all tables, removing the dependency on
-- per-developer discipline.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Shared trigger function (created once, reused by all triggers)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Apply trigger to every table that has an updated_at column
-- Idempotent: DROP IF EXISTS before CREATE ensures reruns are safe.
-- ---------------------------------------------------------------------------

-- organisations
DROP TRIGGER IF EXISTS set_updated_at_organisations ON organisations;
CREATE TRIGGER set_updated_at_organisations
  BEFORE UPDATE ON organisations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- users
DROP TRIGGER IF EXISTS set_updated_at_users ON users;
CREATE TRIGGER set_updated_at_users
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- subaccounts
DROP TRIGGER IF EXISTS set_updated_at_subaccounts ON subaccounts;
CREATE TRIGGER set_updated_at_subaccounts
  BEFORE UPDATE ON subaccounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- agents
DROP TRIGGER IF EXISTS set_updated_at_agents ON agents;
CREATE TRIGGER set_updated_at_agents
  BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- system_agents
DROP TRIGGER IF EXISTS set_updated_at_system_agents ON system_agents;
CREATE TRIGGER set_updated_at_system_agents
  BEFORE UPDATE ON system_agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- agent_data_sources
DROP TRIGGER IF EXISTS set_updated_at_agent_data_sources ON agent_data_sources;
CREATE TRIGGER set_updated_at_agent_data_sources
  BEFORE UPDATE ON agent_data_sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- agent_conversations
DROP TRIGGER IF EXISTS set_updated_at_agent_conversations ON agent_conversations;
CREATE TRIGGER set_updated_at_agent_conversations
  BEFORE UPDATE ON agent_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- agent_runs
DROP TRIGGER IF EXISTS set_updated_at_agent_runs ON agent_runs;
CREATE TRIGGER set_updated_at_agent_runs
  BEFORE UPDATE ON agent_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- agent_templates (deprecated but has updated_at)
DROP TRIGGER IF EXISTS set_updated_at_agent_templates ON agent_templates;
CREATE TRIGGER set_updated_at_agent_templates
  BEFORE UPDATE ON agent_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- agent_triggers
DROP TRIGGER IF EXISTS set_updated_at_agent_triggers ON agent_triggers;
CREATE TRIGGER set_updated_at_agent_triggers
  BEFORE UPDATE ON agent_triggers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- skills
DROP TRIGGER IF EXISTS set_updated_at_skills ON skills;
CREATE TRIGGER set_updated_at_skills
  BEFORE UPDATE ON skills
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- system_skills
DROP TRIGGER IF EXISTS set_updated_at_system_skills ON system_skills;
CREATE TRIGGER set_updated_at_system_skills
  BEFORE UPDATE ON system_skills
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- board_configs
DROP TRIGGER IF EXISTS set_updated_at_board_configs ON board_configs;
CREATE TRIGGER set_updated_at_board_configs
  BEFORE UPDATE ON board_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- board_templates
DROP TRIGGER IF EXISTS set_updated_at_board_templates ON board_templates;
CREATE TRIGGER set_updated_at_board_templates
  BEFORE UPDATE ON board_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- subaccount_agents
DROP TRIGGER IF EXISTS set_updated_at_subaccount_agents ON subaccount_agents;
CREATE TRIGGER set_updated_at_subaccount_agents
  BEFORE UPDATE ON subaccount_agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- tasks
DROP TRIGGER IF EXISTS set_updated_at_tasks ON tasks;
CREATE TRIGGER set_updated_at_tasks
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- workspace_memories
DROP TRIGGER IF EXISTS set_updated_at_workspace_memories ON workspace_memories;
CREATE TRIGGER set_updated_at_workspace_memories
  BEFORE UPDATE ON workspace_memories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- workspace_entities
DROP TRIGGER IF EXISTS set_updated_at_workspace_entities ON workspace_entities;
CREATE TRIGGER set_updated_at_workspace_entities
  BEFORE UPDATE ON workspace_entities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- workflow_engines
DROP TRIGGER IF EXISTS set_updated_at_workflow_engines ON workflow_engines;
CREATE TRIGGER set_updated_at_workflow_engines
  BEFORE UPDATE ON workflow_engines
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- workspace_limits
DROP TRIGGER IF EXISTS set_updated_at_workspace_limits ON workspace_limits;
CREATE TRIGGER set_updated_at_workspace_limits
  BEFORE UPDATE ON workspace_limits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- scheduled_tasks
DROP TRIGGER IF EXISTS set_updated_at_scheduled_tasks ON scheduled_tasks;
CREATE TRIGGER set_updated_at_scheduled_tasks
  BEFORE UPDATE ON scheduled_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- actions
DROP TRIGGER IF EXISTS set_updated_at_actions ON actions;
CREATE TRIGGER set_updated_at_actions
  BEFORE UPDATE ON actions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- review_items
DROP TRIGGER IF EXISTS set_updated_at_review_items ON review_items;
CREATE TRIGGER set_updated_at_review_items
  BEFORE UPDATE ON review_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- integration_connections
DROP TRIGGER IF EXISTS set_updated_at_integration_connections ON integration_connections;
CREATE TRIGGER set_updated_at_integration_connections
  BEFORE UPDATE ON integration_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- process_connection_mappings
DROP TRIGGER IF EXISTS set_updated_at_process_connection_mappings ON process_connection_mappings;
CREATE TRIGGER set_updated_at_process_connection_mappings
  BEFORE UPDATE ON process_connection_mappings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- subaccount_process_links
DROP TRIGGER IF EXISTS set_updated_at_subaccount_process_links ON subaccount_process_links;
CREATE TRIGGER set_updated_at_subaccount_process_links
  BEFORE UPDATE ON subaccount_process_links
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- process_categories
DROP TRIGGER IF EXISTS set_updated_at_process_categories ON process_categories;
CREATE TRIGGER set_updated_at_process_categories
  BEFORE UPDATE ON process_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- subaccount_categories
DROP TRIGGER IF EXISTS set_updated_at_subaccount_categories ON subaccount_categories;
CREATE TRIGGER set_updated_at_subaccount_categories
  BEFORE UPDATE ON subaccount_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- hierarchy_templates
DROP TRIGGER IF EXISTS set_updated_at_hierarchy_templates ON hierarchy_templates;
CREATE TRIGGER set_updated_at_hierarchy_templates
  BEFORE UPDATE ON hierarchy_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- system_hierarchy_templates
DROP TRIGGER IF EXISTS set_updated_at_system_hierarchy_templates ON system_hierarchy_templates;
CREATE TRIGGER set_updated_at_system_hierarchy_templates
  BEFORE UPDATE ON system_hierarchy_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- permission_sets
DROP TRIGGER IF EXISTS set_updated_at_permission_sets ON permission_sets;
CREATE TRIGGER set_updated_at_permission_sets
  BEFORE UPDATE ON permission_sets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- org_user_roles
DROP TRIGGER IF EXISTS set_updated_at_org_user_roles ON org_user_roles;
CREATE TRIGGER set_updated_at_org_user_roles
  BEFORE UPDATE ON org_user_roles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- subaccount_user_assignments
DROP TRIGGER IF EXISTS set_updated_at_subaccount_user_assignments ON subaccount_user_assignments;
CREATE TRIGGER set_updated_at_subaccount_user_assignments
  BEFORE UPDATE ON subaccount_user_assignments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- processes
DROP TRIGGER IF EXISTS set_updated_at_processes ON processes;
CREATE TRIGGER set_updated_at_processes
  BEFORE UPDATE ON processes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- executions
DROP TRIGGER IF EXISTS set_updated_at_executions ON executions;
CREATE TRIGGER set_updated_at_executions
  BEFORE UPDATE ON executions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- org_budgets
DROP TRIGGER IF EXISTS set_updated_at_org_budgets ON org_budgets;
CREATE TRIGGER set_updated_at_org_budgets
  BEFORE UPDATE ON org_budgets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- projects
DROP TRIGGER IF EXISTS set_updated_at_projects ON projects;
CREATE TRIGGER set_updated_at_projects
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
