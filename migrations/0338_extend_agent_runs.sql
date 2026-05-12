-- Migration 0338: Extend agent_runs for the operator_managed backend
--
-- 1. Extends agent_runs.status CHECK constraint with four new paused_* states
--    introduced by the operator_managed execution backend (spec §3.4):
--    - paused_for_chain_continuation
--    - paused_chain_failure
--    - paused_budget_exceeded
--    - paused_wall_clock_exceeded
--    Also includes blocked_awaiting_integration which was added to the schema
--    type in agentRuns.ts but was not in the previous DB constraint.
--
-- 2. Adds operator_chain_failure_count column (spec §3.4): counts consecutive
--    chain-link dispatch-start failures since the last successful dispatch.
--
-- Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.4

-- Drop and re-create the status CHECK constraint with the extended allow-list.
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
      'blocked_awaiting_integration',
      'paused_for_chain_continuation',
      'paused_chain_failure',
      'paused_budget_exceeded',
      'paused_wall_clock_exceeded'
    )
  );

-- Add operator_chain_failure_count column (spec §3.4).
-- Counts consecutive chain-link dispatch-start failures since the last
-- successful dispatch. Sole writer is the dispatcher; reset to 0 on any
-- successful dispatch.
ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS operator_chain_failure_count integer NOT NULL DEFAULT 0;

-- Enforce non-negative invariant
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_runs_operator_chain_failure_count_check'
      AND conrelid = 'agent_runs'::regclass
  ) THEN
    ALTER TABLE agent_runs
      ADD CONSTRAINT agent_runs_operator_chain_failure_count_check
      CHECK (operator_chain_failure_count >= 0);
  END IF;
END$$;
