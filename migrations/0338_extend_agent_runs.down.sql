-- Down migration for 0330_extend_agent_runs.sql
--
-- Removes operator_chain_failure_count and reverts status CHECK to the
-- pre-operator-backend allow-list.
-- NOTE: ensure no rows hold paused_* values before applying this rollback.

ALTER TABLE agent_runs
  DROP COLUMN IF EXISTS operator_chain_failure_count;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_runs_status_check'
      AND conrelid = 'agent_runs'::regclass
  ) THEN
    ALTER TABLE agent_runs DROP CONSTRAINT agent_runs_status_check;
  END IF;
END$$;

ALTER TABLE agent_runs
  ADD CONSTRAINT agent_runs_status_check CHECK (
    status IN (
      'pending',
      'running',
      'delegated',
      'cancelling',
      'completed',
      'failed',
      'cancelled',
      'timeout',
      'budget_exceeded',
      'loop_detected',
      'awaiting_clarification',
      'waiting_on_clarification',
      'completed_with_uncertainty',
      'blocked_awaiting_integration'
    )
  );
