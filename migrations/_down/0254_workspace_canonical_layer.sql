-- Down migration for 0254_workspace_canonical_layer.sql
-- Drops the four workspace canonical tables, trigger functions, enum,
-- and restores the original connector_configs unique index.

BEGIN;

-- Drop tables (cascade removes indexes, triggers, and policies)
DROP TABLE IF EXISTS workspace_calendar_events CASCADE;
DROP TABLE IF EXISTS workspace_messages CASCADE;
DROP TABLE IF EXISTS workspace_identities CASCADE;
DROP TABLE IF EXISTS workspace_actors CASCADE;

-- Drop trigger functions
DROP FUNCTION IF EXISTS workspace_identities_backend_matches_config() CASCADE;
DROP FUNCTION IF EXISTS workspace_identities_actor_same_subaccount() CASCADE;
DROP FUNCTION IF EXISTS workspace_actors_parent_same_subaccount() CASCADE;

-- Drop enum
DROP TYPE IF EXISTS workspace_identity_status;

-- Restore original connector_configs unique index
DROP INDEX IF EXISTS connector_configs_org_type_uniq_crm;
DROP INDEX IF EXISTS connector_configs_org_subaccount_type_uniq_workspace;

CREATE UNIQUE INDEX connector_configs_org_type_unique
  ON connector_configs (organisation_id, connector_type);

COMMIT;
