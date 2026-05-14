-- Phase 0 prereqs: three additive nullable column additions across three tables.
-- P1: agent_runs.correlation_id  — carries the request/job correlation ID into
--     the incident ingestor so incident events can be traced back to the run.
-- P4: tasks.linked_entity_kind + tasks.linked_entity_id — used by the manual
--     escalate-to-agent flow to link tasks created from a system incident back
--     to their source incident row.
-- §10.3: organisations.is_system_org — identifies the seeded System Operations
--     org so org-listing endpoints can filter it from non-sysadmin views.
--     Partial unique index guarantees at most one is_system_org = true row.
--
-- All changes are additive, nullable/defaulted, and backwards-compatible.

-- P1: correlation ID on agent runs (nullable; set by callers that have a tracing
-- context; ignored by the ingestor when absent)
ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS correlation_id text;

-- P4: linked entity reference on tasks
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS linked_entity_kind text,
  ADD COLUMN IF NOT EXISTS linked_entity_id uuid;

-- §10.3: system org flag
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS is_system_org boolean NOT NULL DEFAULT false;

-- Partial unique index: only one organisation may have is_system_org = true.
-- This is the hard enforcement that prevents accidental duplicates if the seed
-- migration runs more than once (it is idempotent anyway, but belt + braces).
CREATE UNIQUE INDEX IF NOT EXISTS organisations_system_org_unique_idx
  ON organisations (is_system_org)
  WHERE is_system_org = true;
