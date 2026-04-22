-- Migration 0193 — Universal Brief Phase 1: org persona label
--
-- Spec: docs/universal-brief-dev-spec.md §5.2 + §14.1
--
-- Adds agentPersonaLabel to organisations table. Default 'COO' is the
-- user-facing name for the virtual agent. No schema change to tasks.status
-- (value-level expansion only — no CHECK constraint update needed since
-- status is a plain text column).

ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS agent_persona_label text NOT NULL DEFAULT 'COO';

-- Also add clarifyingEnabled + sparringEnabled for Phase 4 (folded here
-- to keep migrations small and since Phase 1 is the natural org-settings
-- migration home).
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS clarifying_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sparring_enabled boolean NOT NULL DEFAULT true;
