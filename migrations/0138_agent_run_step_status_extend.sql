-- Migration 0138 — agent_runs.status enum extension for clarification states
--
-- Extends the agent_runs.status CHECK constraint to include:
--   - 'waiting_on_clarification' — run paused waiting on a blocking clarification
--   - 'completed_with_uncertainty' — run completed after a clarification timeout
--
-- Spec: docs/memory-and-briefings-spec.md §5.4 (S8)
--
-- Rollback: drop the constraint replacement; ensure no rows hold the new
-- values before rolling back (backfill to nearest terminal state first).

DO $$
BEGIN
  -- Drop the existing status check constraint if present, then re-create
  -- with the extended value list. Constraint name drawn from Drizzle's
  -- default `<table>_<column>_check` pattern; be defensive about variants.
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
      'completed',
      'failed',
      'cancelled',
      'timeout',
      'budget_exceeded',
      'awaiting_clarification',
      'waiting_on_clarification',
      'completed_with_uncertainty'
    )
  );
