-- Migration 0140 — memory_citation_scores table
--
-- Per-entry citation scores for the S12 citation detector. One row per
-- (run_id, entry_id) where entry_id refers to a memory entry injected into
-- the run. Used by S4 for rolling-window utility rate computation.
--
-- Spec: docs/memory-and-briefings-spec.md §4.4 (S12)

CREATE TABLE IF NOT EXISTS memory_citation_scores (
  run_id uuid NOT NULL
    REFERENCES agent_runs(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL
    REFERENCES workspace_memory_entries(id) ON DELETE CASCADE,
  tool_call_score real NOT NULL,
  text_score real NOT NULL,
  final_score real NOT NULL,
  cited boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (run_id, entry_id)
);

-- S4 rolling-window queries walk entry_id → recent scores, so index on
-- (entry_id, created_at DESC) for efficient range scans.
CREATE INDEX IF NOT EXISTS memory_citation_scores_entry_created_idx
  ON memory_citation_scores (entry_id, created_at DESC);
