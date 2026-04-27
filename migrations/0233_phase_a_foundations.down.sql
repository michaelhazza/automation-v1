-- Down migration for 0233_phase_a_foundations.sql
-- Removes all Phase A additions in reverse order.
-- Note: does not remove the system_monitor system agent row or system principal
-- user — those are seed data and removal may cause FK violations if referenced.

ALTER TABLE system_incidents DROP COLUMN IF EXISTS investigate_prompt;
ALTER TABLE system_incidents DROP COLUMN IF EXISTS agent_diagnosis;
ALTER TABLE system_incidents DROP COLUMN IF EXISTS agent_diagnosis_run_id;
ALTER TABLE system_incidents DROP COLUMN IF EXISTS prompt_was_useful;
ALTER TABLE system_incidents DROP COLUMN IF EXISTS prompt_feedback_text;
ALTER TABLE system_incidents DROP COLUMN IF EXISTS triage_attempt_count;
ALTER TABLE system_incidents DROP COLUMN IF EXISTS last_triage_attempt_at;
ALTER TABLE system_incidents DROP COLUMN IF EXISTS sweep_evidence_run_ids;

DROP TABLE IF EXISTS system_monitor_heuristic_fires;
DROP TABLE IF EXISTS system_monitor_baselines;

-- Restore original execution_scope enum (drop the widened constraint, re-add narrow one)
ALTER TABLE system_agents
  DROP CONSTRAINT IF EXISTS system_agents_execution_scope_enum;

ALTER TABLE system_agents
  ADD CONSTRAINT system_agents_execution_scope_enum
  CHECK (execution_scope IN ('org', 'subaccount'));
