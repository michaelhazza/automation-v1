-- =============================================================================
-- Playbooks — down migration (local rollback only, NEVER run in production)
--
-- The custom forward-only runner at scripts/migrate.ts does not execute
-- down migrations. This file exists for manual local rollback during
-- development.
-- =============================================================================

DROP INDEX IF EXISTS agent_runs_playbook_step_run_id_idx;
ALTER TABLE agent_runs DROP COLUMN IF EXISTS playbook_step_run_id;

DROP TABLE IF EXISTS playbook_studio_sessions;
DROP TABLE IF EXISTS playbook_step_reviews;
DROP TABLE IF EXISTS playbook_step_runs;
DROP TABLE IF EXISTS playbook_run_event_sequences;
DROP TABLE IF EXISTS playbook_runs;
DROP TABLE IF EXISTS playbook_template_versions;
DROP TABLE IF EXISTS playbook_templates;
DROP TABLE IF EXISTS system_playbook_template_versions;
DROP TABLE IF EXISTS system_playbook_templates;
