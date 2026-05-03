-- Workflows V1: make agent_execution_events.run_id / sequence_number nullable (Chunk 9 F1)
--
-- Motivation: pause/resume/stop/pool-refresh task events have no agent_run
-- context. Keeping run_id NOT NULL caused FK violations and silently swallowed
-- those events. Making run_id (and sequence_number, which is allocated from
-- agent_runs) nullable allows task-scoped events without an owning agent run;
-- the check constraint ensures every row has at least one scope anchor.

-- 1. Drop the inline UNIQUE (run_id, sequence_number) from 0192. The partial
--    index created below replaces it for run-scoped rows.
ALTER TABLE agent_execution_events
  DROP CONSTRAINT IF EXISTS agent_execution_events_run_id_sequence_number_key;

-- 2. Allow run_id to be NULL (FK to agent_runs still enforced when not NULL).
ALTER TABLE agent_execution_events ALTER COLUMN run_id DROP NOT NULL;

-- 3. Allow sequence_number to be NULL (task-only events have no agent_run seq).
ALTER TABLE agent_execution_events ALTER COLUMN sequence_number DROP NOT NULL;

-- 4. At least one of (run_id, task_id) must be set; an event with neither is meaningless.
ALTER TABLE agent_execution_events
  ADD CONSTRAINT agent_execution_events_scope_required
  CHECK (run_id IS NOT NULL OR task_id IS NOT NULL);

-- 5. Replace the existing unconditional index on (run_id, sequence_number) with a
--    partial index covering only run-scoped rows. Task-only rows are excluded.
DROP INDEX IF EXISTS agent_execution_events_run_seq_idx;
CREATE INDEX agent_execution_events_run_seq_idx
  ON agent_execution_events(run_id, sequence_number)
  WHERE run_id IS NOT NULL;
