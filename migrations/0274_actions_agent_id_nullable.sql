-- Migration 0274: actions — make agent_id nullable for system-initiated actions
-- Spec: tasks/builds/agentic-commerce/spec.md §12 (Shadow-to-live promotion)
-- Plan: tasks/builds/agentic-commerce/plan.md § Chunk 15
-- Branch: claude/agentic-commerce-spending
--
-- Purpose:
--   The promote_spending_policy_to_live HITL action is operator/system-initiated
--   rather than agent-initiated. The original actions.agent_id NOT NULL constraint
--   predates system-originated actions. Dropping NOT NULL allows system rows
--   (where agent_id is NULL) to coexist with agent-originated rows.
--
--   Application code must still supply a valid UUID when the action originates
--   from an agent run; NULL is reserved exclusively for system/operator flows.
--
-- Safe to run on live data: DROP NOT NULL is a metadata-only change in Postgres;
-- no row rewrites, no lock escalation beyond the brief ALTER TABLE share lock.

ALTER TABLE actions ALTER COLUMN agent_id DROP NOT NULL;
