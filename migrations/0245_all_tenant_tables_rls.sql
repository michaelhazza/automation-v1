-- Migration 0245: Canonical org-isolation RLS policies for all 55 tenant tables
-- registered in server/config/rlsProtectedTables.ts as 'register-with-new-policy'.
-- All tables use the canonical USING + WITH CHECK shape from spec §2.1.
-- Exceptions: org_margin_configs and skills use nullable-aware USING + WITH CHECK
-- (organisation_id IS NULL rows are visible cross-tenant as platform defaults).
-- Each table block is independently revertible via its own rollback comment.
-- This migration is idempotent: DROP POLICY IF EXISTS ... ; CREATE POLICY ... shape.

-- ── account_overrides ─────────────────────────────────────────────────────────
ALTER TABLE account_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_overrides FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY account_overrides_org_isolation ON account_overrides; ALTER TABLE account_overrides NO FORCE ROW LEVEL SECURITY; ALTER TABLE account_overrides DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS account_overrides_org_isolation ON account_overrides;
CREATE POLICY account_overrides_org_isolation ON account_overrides
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

-- ── action_events ─────────────────────────────────────────────────────────────
ALTER TABLE action_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_events FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY action_events_org_isolation ON action_events; ALTER TABLE action_events NO FORCE ROW LEVEL SECURITY; ALTER TABLE action_events DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS action_events_org_isolation ON action_events;
CREATE POLICY action_events_org_isolation ON action_events
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

-- ── action_resume_events ──────────────────────────────────────────────────────
ALTER TABLE action_resume_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_resume_events FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY action_resume_events_org_isolation ON action_resume_events; ALTER TABLE action_resume_events NO FORCE ROW LEVEL SECURITY; ALTER TABLE action_resume_events DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS action_resume_events_org_isolation ON action_resume_events;
CREATE POLICY action_resume_events_org_isolation ON action_resume_events
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

-- ── agent_conversations ───────────────────────────────────────────────────────
ALTER TABLE agent_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_conversations FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY agent_conversations_org_isolation ON agent_conversations; ALTER TABLE agent_conversations NO FORCE ROW LEVEL SECURITY; ALTER TABLE agent_conversations DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_conversations_org_isolation ON agent_conversations;
CREATE POLICY agent_conversations_org_isolation ON agent_conversations
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

-- ── agent_prompt_revisions ────────────────────────────────────────────────────
ALTER TABLE agent_prompt_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_prompt_revisions FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY agent_prompt_revisions_org_isolation ON agent_prompt_revisions; ALTER TABLE agent_prompt_revisions NO FORCE ROW LEVEL SECURITY; ALTER TABLE agent_prompt_revisions DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_prompt_revisions_org_isolation ON agent_prompt_revisions;
CREATE POLICY agent_prompt_revisions_org_isolation ON agent_prompt_revisions
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

-- ── agent_triggers ────────────────────────────────────────────────────────────
ALTER TABLE agent_triggers ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_triggers FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY agent_triggers_org_isolation ON agent_triggers; ALTER TABLE agent_triggers NO FORCE ROW LEVEL SECURITY; ALTER TABLE agent_triggers DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_triggers_org_isolation ON agent_triggers;
CREATE POLICY agent_triggers_org_isolation ON agent_triggers
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

-- ── agents ────────────────────────────────────────────────────────────────────
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY agents_org_isolation ON agents; ALTER TABLE agents NO FORCE ROW LEVEL SECURITY; ALTER TABLE agents DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agents_org_isolation ON agents;
CREATE POLICY agents_org_isolation ON agents
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

-- ── board_configs ─────────────────────────────────────────────────────────────
ALTER TABLE board_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_configs FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY board_configs_org_isolation ON board_configs; ALTER TABLE board_configs NO FORCE ROW LEVEL SECURITY; ALTER TABLE board_configs DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS board_configs_org_isolation ON board_configs;
CREATE POLICY board_configs_org_isolation ON board_configs
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

-- ── config_backups ────────────────────────────────────────────────────────────
ALTER TABLE config_backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_backups FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY config_backups_org_isolation ON config_backups; ALTER TABLE config_backups NO FORCE ROW LEVEL SECURITY; ALTER TABLE config_backups DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS config_backups_org_isolation ON config_backups;
CREATE POLICY config_backups_org_isolation ON config_backups
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

-- ── config_history ────────────────────────────────────────────────────────────
ALTER TABLE config_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_history FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY config_history_org_isolation ON config_history; ALTER TABLE config_history NO FORCE ROW LEVEL SECURITY; ALTER TABLE config_history DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS config_history_org_isolation ON config_history;
CREATE POLICY config_history_org_isolation ON config_history
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

-- ── connector_configs ─────────────────────────────────────────────────────────
ALTER TABLE connector_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_configs FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY connector_configs_org_isolation ON connector_configs; ALTER TABLE connector_configs NO FORCE ROW LEVEL SECURITY; ALTER TABLE connector_configs DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connector_configs_org_isolation ON connector_configs;
CREATE POLICY connector_configs_org_isolation ON connector_configs
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

-- ── executions ────────────────────────────────────────────────────────────────
ALTER TABLE executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE executions FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY executions_org_isolation ON executions; ALTER TABLE executions NO FORCE ROW LEVEL SECURITY; ALTER TABLE executions DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS executions_org_isolation ON executions;
CREATE POLICY executions_org_isolation ON executions
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

-- ── feedback_votes ────────────────────────────────────────────────────────────
ALTER TABLE feedback_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_votes FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY feedback_votes_org_isolation ON feedback_votes; ALTER TABLE feedback_votes NO FORCE ROW LEVEL SECURITY; ALTER TABLE feedback_votes DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feedback_votes_org_isolation ON feedback_votes;
CREATE POLICY feedback_votes_org_isolation ON feedback_votes
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

-- ── geo_audits ────────────────────────────────────────────────────────────────
ALTER TABLE geo_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE geo_audits FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY geo_audits_org_isolation ON geo_audits; ALTER TABLE geo_audits NO FORCE ROW LEVEL SECURITY; ALTER TABLE geo_audits DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS geo_audits_org_isolation ON geo_audits;
CREATE POLICY geo_audits_org_isolation ON geo_audits
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

-- ── goals ─────────────────────────────────────────────────────────────────────
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY goals_org_isolation ON goals; ALTER TABLE goals NO FORCE ROW LEVEL SECURITY; ALTER TABLE goals DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS goals_org_isolation ON goals;
CREATE POLICY goals_org_isolation ON goals
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

-- ── hierarchy_templates ───────────────────────────────────────────────────────
ALTER TABLE hierarchy_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE hierarchy_templates FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY hierarchy_templates_org_isolation ON hierarchy_templates; ALTER TABLE hierarchy_templates NO FORCE ROW LEVEL SECURITY; ALTER TABLE hierarchy_templates DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hierarchy_templates_org_isolation ON hierarchy_templates;
CREATE POLICY hierarchy_templates_org_isolation ON hierarchy_templates
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

-- ── iee_artifacts ─────────────────────────────────────────────────────────────
ALTER TABLE iee_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE iee_artifacts FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY iee_artifacts_org_isolation ON iee_artifacts; ALTER TABLE iee_artifacts NO FORCE ROW LEVEL SECURITY; ALTER TABLE iee_artifacts DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS iee_artifacts_org_isolation ON iee_artifacts;
CREATE POLICY iee_artifacts_org_isolation ON iee_artifacts
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

-- ── iee_runs ──────────────────────────────────────────────────────────────────
ALTER TABLE iee_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE iee_runs FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY iee_runs_org_isolation ON iee_runs; ALTER TABLE iee_runs NO FORCE ROW LEVEL SECURITY; ALTER TABLE iee_runs DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS iee_runs_org_isolation ON iee_runs;
CREATE POLICY iee_runs_org_isolation ON iee_runs
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

-- ── iee_steps ─────────────────────────────────────────────────────────────────
ALTER TABLE iee_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE iee_steps FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY iee_steps_org_isolation ON iee_steps; ALTER TABLE iee_steps NO FORCE ROW LEVEL SECURITY; ALTER TABLE iee_steps DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS iee_steps_org_isolation ON iee_steps;
CREATE POLICY iee_steps_org_isolation ON iee_steps
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

-- ── intervention_outcomes ─────────────────────────────────────────────────────
ALTER TABLE intervention_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE intervention_outcomes FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY intervention_outcomes_org_isolation ON intervention_outcomes; ALTER TABLE intervention_outcomes NO FORCE ROW LEVEL SECURITY; ALTER TABLE intervention_outcomes DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS intervention_outcomes_org_isolation ON intervention_outcomes;
CREATE POLICY intervention_outcomes_org_isolation ON intervention_outcomes
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

-- ── mcp_server_configs ────────────────────────────────────────────────────────
ALTER TABLE mcp_server_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_server_configs FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY mcp_server_configs_org_isolation ON mcp_server_configs; ALTER TABLE mcp_server_configs NO FORCE ROW LEVEL SECURITY; ALTER TABLE mcp_server_configs DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_server_configs_org_isolation ON mcp_server_configs;
CREATE POLICY mcp_server_configs_org_isolation ON mcp_server_configs
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

-- ── mcp_tool_invocations ──────────────────────────────────────────────────────
ALTER TABLE mcp_tool_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_tool_invocations FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY mcp_tool_invocations_org_isolation ON mcp_tool_invocations; ALTER TABLE mcp_tool_invocations NO FORCE ROW LEVEL SECURITY; ALTER TABLE mcp_tool_invocations DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_tool_invocations_org_isolation ON mcp_tool_invocations;
CREATE POLICY mcp_tool_invocations_org_isolation ON mcp_tool_invocations
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

-- ── org_agent_configs ─────────────────────────────────────────────────────────
ALTER TABLE org_agent_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_agent_configs FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY org_agent_configs_org_isolation ON org_agent_configs; ALTER TABLE org_agent_configs NO FORCE ROW LEVEL SECURITY; ALTER TABLE org_agent_configs DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_agent_configs_org_isolation ON org_agent_configs;
CREATE POLICY org_agent_configs_org_isolation ON org_agent_configs
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

-- ── org_budgets ───────────────────────────────────────────────────────────────
ALTER TABLE org_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_budgets FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY org_budgets_org_isolation ON org_budgets; ALTER TABLE org_budgets NO FORCE ROW LEVEL SECURITY; ALTER TABLE org_budgets DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_budgets_org_isolation ON org_budgets;
CREATE POLICY org_budgets_org_isolation ON org_budgets
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

-- ── org_margin_configs ────────────────────────────────────────────────────────
-- NOTE: organisation_id is nullable; NULL rows are platform-global defaults
-- visible cross-tenant. Nullable-aware USING + WITH CHECK shape applied.
ALTER TABLE org_margin_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_margin_configs FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY org_margin_configs_org_isolation ON org_margin_configs; ALTER TABLE org_margin_configs NO FORCE ROW LEVEL SECURITY; ALTER TABLE org_margin_configs DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_margin_configs_org_isolation ON org_margin_configs;
CREATE POLICY org_margin_configs_org_isolation ON org_margin_configs
  USING (
    organisation_id IS NULL
    OR (
      current_setting('app.organisation_id', true) IS NOT NULL
      AND current_setting('app.organisation_id', true) <> ''
      AND organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  )
  WITH CHECK (
    organisation_id IS NULL
    OR (
      current_setting('app.organisation_id', true) IS NOT NULL
      AND current_setting('app.organisation_id', true) <> ''
      AND organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  );

-- ── org_memories ─────────────────────────────────────────────────────────────
ALTER TABLE org_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_memories FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY org_memories_org_isolation ON org_memories; ALTER TABLE org_memories NO FORCE ROW LEVEL SECURITY; ALTER TABLE org_memories DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_memories_org_isolation ON org_memories;
CREATE POLICY org_memories_org_isolation ON org_memories
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

-- ── org_memory_entries ────────────────────────────────────────────────────────
ALTER TABLE org_memory_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_memory_entries FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY org_memory_entries_org_isolation ON org_memory_entries; ALTER TABLE org_memory_entries NO FORCE ROW LEVEL SECURITY; ALTER TABLE org_memory_entries DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_memory_entries_org_isolation ON org_memory_entries;
CREATE POLICY org_memory_entries_org_isolation ON org_memory_entries
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

-- ── org_user_roles ────────────────────────────────────────────────────────────
ALTER TABLE org_user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_user_roles FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY org_user_roles_org_isolation ON org_user_roles; ALTER TABLE org_user_roles NO FORCE ROW LEVEL SECURITY; ALTER TABLE org_user_roles DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_user_roles_org_isolation ON org_user_roles;
CREATE POLICY org_user_roles_org_isolation ON org_user_roles
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

-- ── organisation_secrets ──────────────────────────────────────────────────────
ALTER TABLE organisation_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE organisation_secrets FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY organisation_secrets_org_isolation ON organisation_secrets; ALTER TABLE organisation_secrets NO FORCE ROW LEVEL SECURITY; ALTER TABLE organisation_secrets DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organisation_secrets_org_isolation ON organisation_secrets;
CREATE POLICY organisation_secrets_org_isolation ON organisation_secrets
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

-- ── page_projects ─────────────────────────────────────────────────────────────
ALTER TABLE page_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_projects FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY page_projects_org_isolation ON page_projects; ALTER TABLE page_projects NO FORCE ROW LEVEL SECURITY; ALTER TABLE page_projects DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS page_projects_org_isolation ON page_projects;
CREATE POLICY page_projects_org_isolation ON page_projects
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

-- ── permission_groups ─────────────────────────────────────────────────────────
ALTER TABLE permission_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_groups FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY permission_groups_org_isolation ON permission_groups; ALTER TABLE permission_groups NO FORCE ROW LEVEL SECURITY; ALTER TABLE permission_groups DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS permission_groups_org_isolation ON permission_groups;
CREATE POLICY permission_groups_org_isolation ON permission_groups
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

-- ── permission_sets ───────────────────────────────────────────────────────────
ALTER TABLE permission_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_sets FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY permission_sets_org_isolation ON permission_sets; ALTER TABLE permission_sets NO FORCE ROW LEVEL SECURITY; ALTER TABLE permission_sets DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS permission_sets_org_isolation ON permission_sets;
CREATE POLICY permission_sets_org_isolation ON permission_sets
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

-- ── playbook_runs ─────────────────────────────────────────────────────────────
ALTER TABLE playbook_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE playbook_runs FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY playbook_runs_org_isolation ON playbook_runs; ALTER TABLE playbook_runs NO FORCE ROW LEVEL SECURITY; ALTER TABLE playbook_runs DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS playbook_runs_org_isolation ON playbook_runs;
CREATE POLICY playbook_runs_org_isolation ON playbook_runs
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

-- ── playbook_templates ────────────────────────────────────────────────────────
ALTER TABLE playbook_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE playbook_templates FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY playbook_templates_org_isolation ON playbook_templates; ALTER TABLE playbook_templates NO FORCE ROW LEVEL SECURITY; ALTER TABLE playbook_templates DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS playbook_templates_org_isolation ON playbook_templates;
CREATE POLICY playbook_templates_org_isolation ON playbook_templates
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

-- ── policy_rules ──────────────────────────────────────────────────────────────
ALTER TABLE policy_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_rules FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY policy_rules_org_isolation ON policy_rules; ALTER TABLE policy_rules NO FORCE ROW LEVEL SECURITY; ALTER TABLE policy_rules DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS policy_rules_org_isolation ON policy_rules;
CREATE POLICY policy_rules_org_isolation ON policy_rules
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

-- ── portal_briefs ─────────────────────────────────────────────────────────────
ALTER TABLE portal_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_briefs FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY portal_briefs_org_isolation ON portal_briefs; ALTER TABLE portal_briefs NO FORCE ROW LEVEL SECURITY; ALTER TABLE portal_briefs DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS portal_briefs_org_isolation ON portal_briefs;
CREATE POLICY portal_briefs_org_isolation ON portal_briefs
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

-- ── process_connection_mappings ───────────────────────────────────────────────
ALTER TABLE process_connection_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE process_connection_mappings FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY process_connection_mappings_org_isolation ON process_connection_mappings; ALTER TABLE process_connection_mappings NO FORCE ROW LEVEL SECURITY; ALTER TABLE process_connection_mappings DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS process_connection_mappings_org_isolation ON process_connection_mappings;
CREATE POLICY process_connection_mappings_org_isolation ON process_connection_mappings
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

-- ── processed_resources ───────────────────────────────────────────────────────
ALTER TABLE processed_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_resources FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY processed_resources_org_isolation ON processed_resources; ALTER TABLE processed_resources NO FORCE ROW LEVEL SECURITY; ALTER TABLE processed_resources DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS processed_resources_org_isolation ON processed_resources;
CREATE POLICY processed_resources_org_isolation ON processed_resources
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

-- ── projects ──────────────────────────────────────────────────────────────────
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY projects_org_isolation ON projects; ALTER TABLE projects NO FORCE ROW LEVEL SECURITY; ALTER TABLE projects DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS projects_org_isolation ON projects;
CREATE POLICY projects_org_isolation ON projects
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

-- ── scheduled_tasks ───────────────────────────────────────────────────────────
ALTER TABLE scheduled_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_tasks FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY scheduled_tasks_org_isolation ON scheduled_tasks; ALTER TABLE scheduled_tasks NO FORCE ROW LEVEL SECURITY; ALTER TABLE scheduled_tasks DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scheduled_tasks_org_isolation ON scheduled_tasks;
CREATE POLICY scheduled_tasks_org_isolation ON scheduled_tasks
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

-- ── skill_analyzer_jobs ───────────────────────────────────────────────────────
ALTER TABLE skill_analyzer_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_analyzer_jobs FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY skill_analyzer_jobs_org_isolation ON skill_analyzer_jobs; ALTER TABLE skill_analyzer_jobs NO FORCE ROW LEVEL SECURITY; ALTER TABLE skill_analyzer_jobs DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS skill_analyzer_jobs_org_isolation ON skill_analyzer_jobs;
CREATE POLICY skill_analyzer_jobs_org_isolation ON skill_analyzer_jobs
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

-- ── skills ────────────────────────────────────────────────────────────────────
-- NOTE: organisation_id is nullable; NULL rows are system/built-in skills
-- visible cross-tenant. Nullable-aware USING + WITH CHECK shape applied.
ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE skills FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY skills_org_isolation ON skills; ALTER TABLE skills NO FORCE ROW LEVEL SECURITY; ALTER TABLE skills DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS skills_org_isolation ON skills;
CREATE POLICY skills_org_isolation ON skills
  USING (
    organisation_id IS NULL
    OR (
      current_setting('app.organisation_id', true) IS NOT NULL
      AND current_setting('app.organisation_id', true) <> ''
      AND organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  )
  WITH CHECK (
    organisation_id IS NULL
    OR (
      current_setting('app.organisation_id', true) IS NOT NULL
      AND current_setting('app.organisation_id', true) <> ''
      AND organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  );

-- ── slack_conversations ───────────────────────────────────────────────────────
ALTER TABLE slack_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack_conversations FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY slack_conversations_org_isolation ON slack_conversations; ALTER TABLE slack_conversations NO FORCE ROW LEVEL SECURITY; ALTER TABLE slack_conversations DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS slack_conversations_org_isolation ON slack_conversations;
CREATE POLICY slack_conversations_org_isolation ON slack_conversations
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

-- ── subaccount_agents ─────────────────────────────────────────────────────────
ALTER TABLE subaccount_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE subaccount_agents FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY subaccount_agents_org_isolation ON subaccount_agents; ALTER TABLE subaccount_agents NO FORCE ROW LEVEL SECURITY; ALTER TABLE subaccount_agents DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subaccount_agents_org_isolation ON subaccount_agents;
CREATE POLICY subaccount_agents_org_isolation ON subaccount_agents
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

-- ── subaccount_onboarding_state ───────────────────────────────────────────────
ALTER TABLE subaccount_onboarding_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE subaccount_onboarding_state FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY subaccount_onboarding_state_org_isolation ON subaccount_onboarding_state; ALTER TABLE subaccount_onboarding_state NO FORCE ROW LEVEL SECURITY; ALTER TABLE subaccount_onboarding_state DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subaccount_onboarding_state_org_isolation ON subaccount_onboarding_state;
CREATE POLICY subaccount_onboarding_state_org_isolation ON subaccount_onboarding_state
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

-- ── subaccount_tags ───────────────────────────────────────────────────────────
ALTER TABLE subaccount_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE subaccount_tags FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY subaccount_tags_org_isolation ON subaccount_tags; ALTER TABLE subaccount_tags NO FORCE ROW LEVEL SECURITY; ALTER TABLE subaccount_tags DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subaccount_tags_org_isolation ON subaccount_tags;
CREATE POLICY subaccount_tags_org_isolation ON subaccount_tags
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

-- ── subaccounts ───────────────────────────────────────────────────────────────
ALTER TABLE subaccounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE subaccounts FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY subaccounts_org_isolation ON subaccounts; ALTER TABLE subaccounts NO FORCE ROW LEVEL SECURITY; ALTER TABLE subaccounts DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subaccounts_org_isolation ON subaccounts;
CREATE POLICY subaccounts_org_isolation ON subaccounts
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

-- ── task_attachments ──────────────────────────────────────────────────────────
ALTER TABLE task_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_attachments FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY task_attachments_org_isolation ON task_attachments; ALTER TABLE task_attachments NO FORCE ROW LEVEL SECURITY; ALTER TABLE task_attachments DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_attachments_org_isolation ON task_attachments;
CREATE POLICY task_attachments_org_isolation ON task_attachments
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

-- ── task_categories ───────────────────────────────────────────────────────────
ALTER TABLE task_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_categories FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY task_categories_org_isolation ON task_categories; ALTER TABLE task_categories NO FORCE ROW LEVEL SECURITY; ALTER TABLE task_categories DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_categories_org_isolation ON task_categories;
CREATE POLICY task_categories_org_isolation ON task_categories
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

-- ── users ─────────────────────────────────────────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY users_org_isolation ON users; ALTER TABLE users NO FORCE ROW LEVEL SECURITY; ALTER TABLE users DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_org_isolation ON users;
CREATE POLICY users_org_isolation ON users
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

-- ── webhook_adapter_configs ───────────────────────────────────────────────────
ALTER TABLE webhook_adapter_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_adapter_configs FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY webhook_adapter_configs_org_isolation ON webhook_adapter_configs; ALTER TABLE webhook_adapter_configs NO FORCE ROW LEVEL SECURITY; ALTER TABLE webhook_adapter_configs DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhook_adapter_configs_org_isolation ON webhook_adapter_configs;
CREATE POLICY webhook_adapter_configs_org_isolation ON webhook_adapter_configs
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

-- ── workspace_entities ────────────────────────────────────────────────────────
ALTER TABLE workspace_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_entities FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY workspace_entities_org_isolation ON workspace_entities; ALTER TABLE workspace_entities NO FORCE ROW LEVEL SECURITY; ALTER TABLE workspace_entities DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_entities_org_isolation ON workspace_entities;
CREATE POLICY workspace_entities_org_isolation ON workspace_entities
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

-- ── workspace_health_findings ─────────────────────────────────────────────────
ALTER TABLE workspace_health_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_health_findings FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY workspace_health_findings_org_isolation ON workspace_health_findings; ALTER TABLE workspace_health_findings NO FORCE ROW LEVEL SECURITY; ALTER TABLE workspace_health_findings DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_health_findings_org_isolation ON workspace_health_findings;
CREATE POLICY workspace_health_findings_org_isolation ON workspace_health_findings
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

-- ── workspace_items ───────────────────────────────────────────────────────────
ALTER TABLE workspace_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_items FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY workspace_items_org_isolation ON workspace_items; ALTER TABLE workspace_items NO FORCE ROW LEVEL SECURITY; ALTER TABLE workspace_items DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_items_org_isolation ON workspace_items;
CREATE POLICY workspace_items_org_isolation ON workspace_items
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

-- ── workspace_memory_entries ──────────────────────────────────────────────────
ALTER TABLE workspace_memory_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_memory_entries FORCE ROW LEVEL SECURITY;
-- prior RLS state: disabled (no policy)
-- rollback: DROP POLICY workspace_memory_entries_org_isolation ON workspace_memory_entries; ALTER TABLE workspace_memory_entries NO FORCE ROW LEVEL SECURITY; ALTER TABLE workspace_memory_entries DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_memory_entries_org_isolation ON workspace_memory_entries;
CREATE POLICY workspace_memory_entries_org_isolation ON workspace_memory_entries
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
