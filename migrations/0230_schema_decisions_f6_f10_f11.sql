-- Migration 0230: Phase 2 schema decisions (F6, F10, F11, F22)
--
-- F6  — workflow_runs.safety_mode: Riley safety posture (explore | execute).
--        Orthogonal to run_mode (how-dispatched vs. what-posture).
-- F10 — subaccount_agents.portal_default_safety_mode: per-(agent,subaccount)
--        safety default for portal-initiated runs.
-- F11 — system_skills.side_effects: boolean flag for gate-resolution; default
--        true (safe) until the seed script backfills per-skill values.
-- F22 — subaccount_agents.last_meaningful_tick_at + ticks_since_last_meaningful_run:
--        updated by the run-completion hook when a run produces meaningful output.

ALTER TABLE workflow_runs
  ADD COLUMN safety_mode text NOT NULL DEFAULT 'explore';

ALTER TABLE subaccount_agents
  ADD COLUMN portal_default_safety_mode text NOT NULL DEFAULT 'explore',
  ADD COLUMN last_meaningful_tick_at timestamptz NULL,
  ADD COLUMN ticks_since_last_meaningful_run integer NOT NULL DEFAULT 0;

ALTER TABLE system_skills
  ADD COLUMN side_effects boolean NOT NULL DEFAULT true;
