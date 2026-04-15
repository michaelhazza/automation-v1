-- Fix: include organisation_id in the version uniqueness constraint.
-- The original constraint on (entity_type, entity_id, version) creates a
-- cross-tenant collision surface. Including organisation_id scopes version
-- sequences per-org, matching the project's org-scoping convention.

BEGIN;

ALTER TABLE config_history
  DROP CONSTRAINT config_history_entity_version_uniq;

ALTER TABLE config_history
  ADD CONSTRAINT config_history_org_entity_version_uniq
  UNIQUE(organisation_id, entity_type, entity_id, version);

COMMIT;
