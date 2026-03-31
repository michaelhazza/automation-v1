-- System-level company templates (shared library for all organisations)
-- These are imported from Paperclip at the system admin level and become platform IP.

CREATE TABLE system_hierarchy_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,

  -- 'manual' | 'paperclip_import'
  source_type TEXT NOT NULL DEFAULT 'paperclip_import',

  -- Raw Paperclip manifest stored for reference
  paperclip_manifest JSONB,

  -- Quick reference count
  agent_count INTEGER NOT NULL DEFAULT 0,

  -- Only published templates are visible to orgs
  is_published BOOLEAN NOT NULL DEFAULT true,

  -- Incremented on every update
  version INTEGER NOT NULL DEFAULT 1,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX system_hierarchy_templates_published_idx
  ON system_hierarchy_templates (is_published)
  WHERE deleted_at IS NULL;

CREATE TABLE system_hierarchy_template_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES system_hierarchy_templates(id) ON DELETE CASCADE,

  -- Set if matched to a system agent on import
  system_agent_id UUID REFERENCES system_agents(id),

  -- Normalised slug (lowercase kebab-case)
  blueprint_slug TEXT NOT NULL,

  -- Original slug from Paperclip manifest
  paperclip_slug TEXT,

  -- Blueprint data
  blueprint_name TEXT,
  blueprint_description TEXT,
  blueprint_icon TEXT,
  blueprint_role TEXT,
  blueprint_title TEXT,
  blueprint_capabilities TEXT,
  blueprint_master_prompt TEXT,
  blueprint_model_provider TEXT,
  blueprint_model_id TEXT,

  -- Hierarchy within template (self-referencing)
  parent_slot_id UUID REFERENCES system_hierarchy_template_slots(id),

  -- Display order among siblings
  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX system_hierarchy_template_slots_template_idx
  ON system_hierarchy_template_slots (template_id);

CREATE INDEX system_hierarchy_template_slots_parent_idx
  ON system_hierarchy_template_slots (parent_slot_id);

CREATE INDEX system_hierarchy_template_slots_slug_idx
  ON system_hierarchy_template_slots (template_id, blueprint_slug);
