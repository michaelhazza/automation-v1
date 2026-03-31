-- 0025: Agent Hierarchy & Organisation Templates
-- Adds parent/child hierarchy to all three agent tiers and introduces
-- org-scoped hierarchy templates with Paperclip import support.

-- ─── Additive columns on existing tables ─────────────────────────────────────

ALTER TABLE system_agents
  ADD COLUMN IF NOT EXISTS parent_system_agent_id uuid REFERENCES system_agents(id),
  ADD COLUMN IF NOT EXISTS agent_role text,
  ADD COLUMN IF NOT EXISTS agent_title text;

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS parent_agent_id uuid REFERENCES agents(id),
  ADD COLUMN IF NOT EXISTS agent_role text,
  ADD COLUMN IF NOT EXISTS agent_title text;

ALTER TABLE subaccount_agents
  ADD COLUMN IF NOT EXISTS parent_subaccount_agent_id uuid REFERENCES subaccount_agents(id),
  ADD COLUMN IF NOT EXISTS agent_role text,
  ADD COLUMN IF NOT EXISTS agent_title text,
  ADD COLUMN IF NOT EXISTS applied_template_id uuid,
  ADD COLUMN IF NOT EXISTS applied_template_version integer;

-- ─── Self-parent CHECK constraints ───────────────────────────────────────────

ALTER TABLE system_agents
  ADD CONSTRAINT system_agents_no_self_parent CHECK (parent_system_agent_id != id);

ALTER TABLE agents
  ADD CONSTRAINT agents_no_self_parent CHECK (parent_agent_id != id);

ALTER TABLE subaccount_agents
  ADD CONSTRAINT subaccount_agents_no_self_parent CHECK (parent_subaccount_agent_id != id);

-- ─── Hierarchy Templates (org-scoped) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hierarchy_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),

  name text NOT NULL,
  description text,

  is_default_for_subaccount boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,

  source_type text NOT NULL DEFAULT 'manual',
  paperclip_manifest jsonb,

  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp
);

CREATE INDEX IF NOT EXISTS hierarchy_templates_org_idx
  ON hierarchy_templates(organisation_id);

CREATE INDEX IF NOT EXISTS hierarchy_templates_org_name_idx
  ON hierarchy_templates(organisation_id, name);

-- ─── Hierarchy Template Slots ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hierarchy_template_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES hierarchy_templates(id) ON DELETE CASCADE,

  system_agent_id uuid REFERENCES system_agents(id),
  agent_id uuid REFERENCES agents(id),

  blueprint_slug text,
  paperclip_slug text,

  blueprint_name text,
  blueprint_description text,
  blueprint_icon text,
  blueprint_role text,
  blueprint_title text,
  blueprint_capabilities text,
  blueprint_master_prompt text,
  blueprint_model_provider text,
  blueprint_model_id text,

  parent_slot_id uuid REFERENCES hierarchy_template_slots(id),
  sort_order integer NOT NULL DEFAULT 0,

  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hierarchy_template_slots_template_idx
  ON hierarchy_template_slots(template_id);

CREATE INDEX IF NOT EXISTS hierarchy_template_slots_parent_idx
  ON hierarchy_template_slots(parent_slot_id);

CREATE INDEX IF NOT EXISTS hierarchy_template_slots_blueprint_slug_idx
  ON hierarchy_template_slots(template_id, blueprint_slug);

-- ─── Indexes on new hierarchy columns ────────────────────────────────────────

CREATE INDEX IF NOT EXISTS system_agents_parent_idx
  ON system_agents(parent_system_agent_id);

CREATE INDEX IF NOT EXISTS agents_parent_idx
  ON agents(parent_agent_id);

CREATE INDEX IF NOT EXISTS subaccount_agents_parent_idx
  ON subaccount_agents(parent_subaccount_agent_id);
