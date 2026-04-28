-- Migration 0241 — agent_runs.status CHECK constraint: add 'cancelling' and 'delegated'
--
-- Two new non-terminal statuses were introduced after migration 0138 set the
-- current constraint:
--   - 'delegated'   — IEE Phase 0 (docs/iee-delegation-lifecycle-spec.md §3.1)
--   - 'cancelling'  — user-triggered cancel signal
--                     (tasks/builds/pre-test-audit-fixes/spec.md §5)
--
-- The Drizzle .$type<>() annotation covers the TypeScript layer only; the
-- DB-level CHECK constraint must be updated explicitly via migration.
--
-- Rollback: drop and re-create the constraint without 'cancelling' and
-- 'delegated'. Ensure no rows hold those values before rolling back.

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
      'completed_with_uncertainty'
    )
  );
