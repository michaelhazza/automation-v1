-- Migration 0137 — agent_runs citation tracking
--
-- Adds citation-tracking columns to `agent_runs` for the S12 citation
-- detector and the S8 clarification uncertainty flag.
--
-- Spec: docs/memory-and-briefings-spec.md §4.4 (S12), §5.4 (S8)

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS cited_entry_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS had_uncertainty boolean NOT NULL DEFAULT false;

-- Note: the step-status enum extension for 'waiting_on_clarification' and
-- 'completed_with_uncertainty' lives in migration 0138. For Phase 2, the
-- existing 'awaiting_clarification' run status covers blocking clarifications
-- until 0138 lands.
