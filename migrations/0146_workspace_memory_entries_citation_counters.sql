-- Migration 0146 — per-entry citation counters
--
-- Adds `cited_count` and `injected_count` columns to workspace_memory_entries
-- for the S12 citation detector + S4 utility-rate adjustment.
--
-- Spec: docs/memory-and-briefings-spec.md §4.4 (S12, S4)

ALTER TABLE workspace_memory_entries
  ADD COLUMN IF NOT EXISTS cited_count integer NOT NULL DEFAULT 0;

ALTER TABLE workspace_memory_entries
  ADD COLUMN IF NOT EXISTS injected_count integer NOT NULL DEFAULT 0;

-- Index on (injected_count, cited_count) is not needed — the S4 job walks
-- entries by subaccount_id and reads the counters inline.
