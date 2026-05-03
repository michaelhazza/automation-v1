-- Reverse of 0270_workflows_v1_event_run_id_nullable.sql
--
-- WARNING: Only safe when no rows have run_id = NULL or sequence_number = NULL.
-- Verify first:
--   SELECT COUNT(*) FROM agent_execution_events WHERE run_id IS NULL;
--   SELECT COUNT(*) FROM agent_execution_events WHERE sequence_number IS NULL;
--
-- N4: If rows with run_id IS NULL exist (emitted by pause/resume/stop/gate paths
-- after migration 0270 was applied), they must be removed before reverting:
--   DELETE FROM agent_execution_events WHERE run_id IS NULL;
-- Only run this if you are certain those events are no longer needed for replay.

ALTER TABLE agent_execution_events
  DROP CONSTRAINT IF EXISTS agent_execution_events_scope_required;

-- Restore the original unconditional index before re-adding NOT NULL.
DROP INDEX IF EXISTS agent_execution_events_run_seq_idx;
CREATE INDEX agent_execution_events_run_seq_idx
  ON agent_execution_events(run_id, sequence_number);

-- Re-add NOT NULL — will fail if any rows have NULL values.
ALTER TABLE agent_execution_events ALTER COLUMN run_id SET NOT NULL;
ALTER TABLE agent_execution_events ALTER COLUMN sequence_number SET NOT NULL;

-- Restore the original unique constraint.
ALTER TABLE agent_execution_events
  ADD CONSTRAINT agent_execution_events_run_id_sequence_number_key UNIQUE (run_id, sequence_number);
