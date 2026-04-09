-- Migration 0090: Add complexity_hint column to agents (P4.3)
-- Explicit opt-in for plan-then-execute mode.

ALTER TABLE agents ADD COLUMN complexity_hint text
  CHECK (complexity_hint IN ('simple', 'complex'));
