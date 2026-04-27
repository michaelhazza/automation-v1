-- Migration 0233 — Phase A schema for the System Monitoring Agent
-- Creates the active-layer tables (baselines, heuristic fires), adds agent-triage
-- columns to system_incidents, and widens execution_scope to include 'system'
-- so the system_monitor agent row can be seeded by scripts/seed.ts (Phase 4).
--
-- Seed data (system_monitor system_agent, system principal user, org-side agents
-- row, 11 system_skills, master_prompt) lives in scripts/seed.ts and
-- scripts/lib/systemMonitorSeed.ts — single source of truth for all seed data.
--
-- RLS: system_monitor_baselines and system_monitor_heuristic_fires intentionally
-- bypass RLS (same pattern as system_incidents). All access is sysadmin-gated at
-- the route/service layer via withAdminConnectionGuarded({ allowRlsBypass: true }).
-- See phase-A-1-2-spec.md §4.3.

-- ─── Agent-triage columns on system_incidents ────────────────────────────────

ALTER TABLE system_incidents ADD COLUMN investigate_prompt text;
ALTER TABLE system_incidents ADD COLUMN agent_diagnosis jsonb;
ALTER TABLE system_incidents ADD COLUMN agent_diagnosis_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL;
ALTER TABLE system_incidents ADD COLUMN prompt_was_useful boolean;
ALTER TABLE system_incidents ADD COLUMN prompt_feedback_text text;
ALTER TABLE system_incidents ADD COLUMN triage_attempt_count integer NOT NULL DEFAULT 0;
ALTER TABLE system_incidents ADD COLUMN last_triage_attempt_at timestamptz;
ALTER TABLE system_incidents ADD COLUMN sweep_evidence_run_ids uuid[] NOT NULL DEFAULT '{}';

-- ─── system_monitor_baselines ────────────────────────────────────────────────

CREATE TABLE system_monitor_baselines (
  id                    uuid             NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_kind           text             NOT NULL,
  entity_id             text             NOT NULL,
  metric_name           text             NOT NULL,
  window_start          timestamptz      NOT NULL,
  window_end            timestamptz      NOT NULL,
  sample_count          integer          NOT NULL DEFAULT 0,
  p50                   double precision,
  p95                   double precision,
  p99                   double precision,
  mean                  double precision,
  stddev                double precision,
  min                   double precision,
  max                   double precision,
  entity_change_marker  text,
  created_at            timestamptz      NOT NULL DEFAULT now(),
  updated_at            timestamptz      NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX system_monitor_baselines_entity_metric_idx
  ON system_monitor_baselines (entity_kind, entity_id, metric_name);

-- ─── system_monitor_heuristic_fires ─────────────────────────────────────────

CREATE TABLE system_monitor_heuristic_fires (
  id                   uuid             NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  heuristic_id         text             NOT NULL,
  fired_at             timestamptz      NOT NULL DEFAULT now(),
  entity_kind          text             NOT NULL,
  entity_id            text             NOT NULL,
  evidence_run_id      uuid,
  confidence           double precision,
  metadata             jsonb,
  produced_incident_id uuid             REFERENCES system_incidents(id) ON DELETE SET NULL
);

CREATE INDEX system_monitor_heuristic_fires_entity_idx
  ON system_monitor_heuristic_fires (entity_kind, entity_id, fired_at DESC);

CREATE INDEX system_monitor_heuristic_fires_heuristic_idx
  ON system_monitor_heuristic_fires (heuristic_id, fired_at DESC);

-- ─── Widen execution_scope enum on system_agents ────────────────────────────
-- The existing CHECK constraint only covers ('org', 'subaccount').
-- Drop and recreate to include 'system' for the system_monitor agent
-- (seeded by scripts/seed.ts Phase 4).

ALTER TABLE system_agents
  DROP CONSTRAINT IF EXISTS system_agents_execution_scope_enum;

ALTER TABLE system_agents
  ADD CONSTRAINT system_agents_execution_scope_enum
  CHECK (execution_scope IN ('org', 'subaccount', 'system'));
