-- Migration 0148 — memory_block_versions
--
-- Per-block version history for the Memory Block governance UI (§S24).
-- Every content mutation path writes a version row in the same transaction
-- as the block update (idempotent — duplicate consecutive versions coalesce).
--
-- Spec: docs/memory-and-briefings-spec.md §S24 (governance affordances)

CREATE TABLE IF NOT EXISTS memory_block_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_block_id uuid NOT NULL
    REFERENCES memory_blocks(id) ON DELETE CASCADE,
  content text NOT NULL,
  /** Monotonically incremented per block (1, 2, 3, …). */
  version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  /** Null for seed events. */
  created_by_user_id uuid,
  change_source text NOT NULL
    CHECK (change_source IN ('manual_edit', 'seed', 'reset_to_canonical', 'auto_synthesis', 'playbook_upsert')),
  notes text,

  UNIQUE (memory_block_id, version)
);

CREATE INDEX IF NOT EXISTS memory_block_versions_block_version_idx
  ON memory_block_versions (memory_block_id, version DESC);
