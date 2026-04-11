-- Migration 0095: Add handoff_json column to agent_runs (Brain Tree OS adoption P1)
-- Stores a structured handoff document produced when the run reaches a terminal state.
-- See docs/brain-tree-os-adoption-spec.md §P1 for the payload shape (AgentRunHandoffV1).

ALTER TABLE agent_runs ADD COLUMN handoff_json jsonb;

-- Partial index for the "latest handoff for this agent" lookup used by the
-- seedFromPreviousRun read path. Partial so the index size stays bounded —
-- only runs with a built handoff are indexed.
CREATE INDEX agent_runs_latest_handoff_idx
  ON agent_runs (agent_id, subaccount_id, created_at DESC)
  WHERE handoff_json IS NOT NULL;
