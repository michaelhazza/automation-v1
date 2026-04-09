-- Migration 0089: Add plan_json column to agent_runs (P4.3)
-- Stores the agent's emitted plan for complex runs.

ALTER TABLE agent_runs ADD COLUMN plan_json jsonb;
