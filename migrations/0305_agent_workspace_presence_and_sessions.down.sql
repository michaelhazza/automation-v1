DROP TRIGGER IF EXISTS agent_observations_immutability ON agent_observations;
DROP FUNCTION IF EXISTS agent_observations_immutability_guard();

DROP INDEX IF EXISTS iee_artifacts_version_idx;
DROP INDEX IF EXISTS iee_artifacts_event_idx;
DROP INDEX IF EXISTS iee_artifacts_agent_run_idx;

ALTER TABLE iee_artifacts
  DROP COLUMN IF EXISTS produced_version_id,
  DROP COLUMN IF EXISTS producing_event_id,
  DROP COLUMN IF EXISTS agent_run_id;

DROP TABLE IF EXISTS agent_working_time_event_ledger;
DROP TABLE IF EXISTS agent_working_time_rollups;
DROP TABLE IF EXISTS agent_presence_projections;
DROP TABLE IF EXISTS iee_sessions;
DROP TABLE IF EXISTS agent_observations;
