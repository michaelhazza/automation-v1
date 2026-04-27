-- Migration 0233 — Phase A foundations for the System Monitoring Agent
-- Creates the active-layer tables (baselines, heuristic fires), adds agent-triage
-- columns to system_incidents, widens execution_scope to include 'system', and
-- seeds the system_monitor system agent + system principal user.
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
-- Drop and recreate to include 'system' for the system_monitor agent.

ALTER TABLE system_agents
  DROP CONSTRAINT IF EXISTS system_agents_execution_scope_enum;

ALTER TABLE system_agents
  ADD CONSTRAINT system_agents_execution_scope_enum
  CHECK (execution_scope IN ('org', 'subaccount', 'system'));

-- ─── Seed system_monitor system agent ───────────────────────────────────────

INSERT INTO system_agents (
  id, name, slug, description, master_prompt, model_provider, model_id,
  temperature, max_tokens, default_system_skill_slugs, execution_scope,
  is_published, version, status
) VALUES (
  gen_random_uuid(),
  'System Monitor',
  'system_monitor',
  'Autonomous agent that diagnoses system incidents and generates investigation prompts.',
  '<TBD by Slice C>',
  'anthropic',
  'claude-sonnet-4-6',
  0.3,
  8096,
  '[]'::jsonb,
  'system',
  true,
  1,
  'active'
) ON CONFLICT (slug) DO NOTHING;

-- ─── Seed system principal user ──────────────────────────────────────────────
-- This user owns system-initiated agent runs so audit logs have a valid actor.
-- password_hash is a non-functional placeholder — the system principal never
-- authenticates interactively.

INSERT INTO users (id, organisation_id, email, password_hash, first_name, last_name, role, status)
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid,
  o.id,
  'system@platform.local',
  '$2b$12$system.principal.placeholder.hash.not.used.for.auth',
  'System',
  'Principal',
  'system_admin',
  'active'
FROM organisations o
WHERE o.is_system_org = true
ON CONFLICT (id) DO NOTHING;

-- ─── Seed org-side agents row for system_monitor ─────────────────────────────
-- Creates the org-facing agents record linked to the system_monitor system agent.
-- ON CONFLICT DO NOTHING makes this idempotent (partial unique index on
-- (organisation_id, slug) WHERE deleted_at IS NULL prevents a target clause).

INSERT INTO agents (organisation_id, system_agent_id, is_system_managed, name, slug, master_prompt, status, created_at, updated_at)
SELECT
  o.id,
  sa.id,
  true,
  'System Monitor',
  'system_monitor',
  '',
  'active',
  now(),
  now()
FROM organisations o
CROSS JOIN system_agents sa
WHERE o.is_system_org = true
AND sa.slug = 'system_monitor'
ON CONFLICT DO NOTHING;
