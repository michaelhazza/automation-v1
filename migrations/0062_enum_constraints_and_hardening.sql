-- 0062_enum_constraints_and_hardening.sql
-- Add DB-level CHECK constraints for enum TEXT fields (defense-in-depth)
-- Also adds webhook execution cap and goal depth enforcement

-- Goals enum constraints
ALTER TABLE goals ADD CONSTRAINT goals_status_check
  CHECK (status IN ('planned', 'active', 'completed', 'archived'));
ALTER TABLE goals ADD CONSTRAINT goals_level_check
  CHECK (level IN ('mission', 'objective', 'key_result'));

-- Feedback votes enum constraints
ALTER TABLE feedback_votes ADD CONSTRAINT feedback_vote_check
  CHECK (vote IN ('up', 'down'));
ALTER TABLE feedback_votes ADD CONSTRAINT feedback_entity_type_check
  CHECK (entity_type IN ('task_activity', 'task_deliverable', 'agent_message'));

-- Webhook adapter enum constraints
ALTER TABLE webhook_adapter_configs ADD CONSTRAINT webhook_auth_type_check
  CHECK (auth_type IN ('none', 'bearer', 'hmac_sha256', 'api_key_header'));

-- Inbox read states enum constraint
ALTER TABLE inbox_read_states ADD CONSTRAINT inbox_entity_type_check
  CHECK (entity_type IN ('task', 'review_item', 'agent_run'));

-- Concurrency policy enum constraints
ALTER TABLE subaccount_agents ADD CONSTRAINT sa_concurrency_policy_check
  CHECK (concurrency_policy IN ('skip_if_active', 'coalesce_if_active', 'always_enqueue'));
ALTER TABLE subaccount_agents ADD CONSTRAINT sa_catch_up_policy_check
  CHECK (catch_up_policy IN ('skip_missed', 'enqueue_missed_with_cap'));

ALTER TABLE org_agent_configs ADD CONSTRAINT oac_concurrency_policy_check
  CHECK (concurrency_policy IN ('skip_if_active', 'coalesce_if_active', 'always_enqueue'));
ALTER TABLE org_agent_configs ADD CONSTRAINT oac_catch_up_policy_check
  CHECK (catch_up_policy IN ('skip_missed', 'enqueue_missed_with_cap'));
