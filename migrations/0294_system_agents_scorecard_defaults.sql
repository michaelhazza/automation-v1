-- 0294_system_agents_scorecard_defaults.sql
-- Trust & Verification Layer — Chunk 6, spec §3, §6.7
--
-- Adds scorecard default slug columns to system_agents and agent_templates,
-- and org_mandatory_scorecard_slugs to organisations.
--
-- These columns are jsonb arrays (never NULL — defaulting to empty array)
-- so callers can iterate without null-checking.

-- system_agents: two new columns for cascading scorecard defaults
ALTER TABLE system_agents
  ADD COLUMN IF NOT EXISTS default_system_scorecard_slugs jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS default_org_scorecard_slugs    jsonb NOT NULL DEFAULT '[]';

-- agent_templates: one new column
ALTER TABLE agent_templates
  ADD COLUMN IF NOT EXISTS default_scorecard_slugs jsonb NOT NULL DEFAULT '[]';

-- organisations: mandatory scorecard slugs enforced for all org-linked agents.
-- Always-array invariant enforced by CHECK.
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS org_mandatory_scorecard_slugs jsonb NOT NULL DEFAULT '[]'
    CONSTRAINT organisations_org_mandatory_scorecard_slugs_is_array
      CHECK (jsonb_typeof(org_mandatory_scorecard_slugs) = 'array');
