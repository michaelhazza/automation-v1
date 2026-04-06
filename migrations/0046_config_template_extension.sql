-- Migration 0046: Configuration template system extension
-- Part of Phase 4: Extends hierarchy templates with connector refs,
-- skill enablement maps, and operational parameters.

-- =============================================================================
-- 1. Extend system_hierarchy_templates with configuration fields
-- =============================================================================

-- Connector requirement
ALTER TABLE system_hierarchy_templates ADD COLUMN required_connector_type text;

-- Operational defaults (health score weights, anomaly thresholds, scan frequency, etc.)
ALTER TABLE system_hierarchy_templates ADD COLUMN operational_defaults jsonb;

-- Pre-populated org memory seeds
ALTER TABLE system_hierarchy_templates ADD COLUMN memory_seeds_json jsonb;

-- What the operator must provide during activation
ALTER TABLE system_hierarchy_templates ADD COLUMN required_operator_inputs jsonb;

-- =============================================================================
-- 2. Extend system_hierarchy_template_slots with skill configuration
-- =============================================================================

-- Per-slot skill enablement map {skillSlug: boolean}
ALTER TABLE system_hierarchy_template_slots ADD COLUMN skill_enablement_map jsonb;

-- Whether this slot's agent runs at org or subaccount level
ALTER TABLE system_hierarchy_template_slots ADD COLUMN execution_scope text;

-- =============================================================================
-- 3. Extend hierarchy_templates (org level) with applied config
-- =============================================================================

-- Reference to the connector config created during activation
ALTER TABLE hierarchy_templates ADD COLUMN applied_connector_config_id uuid REFERENCES connector_configs(id);

-- Org-specific operational config (overrides template defaults)
ALTER TABLE hierarchy_templates ADD COLUMN operational_config jsonb;

-- =============================================================================
-- 4. Extend org_agent_configs with template tracking (already exists in schema)
-- No additional columns needed — applied_template_id and applied_template_version
-- were included in the 0043 migration.
-- =============================================================================
