-- Down migration for 0077_hierarchy_templates_system_template_id.sql
-- Local rollback only — production migrations are forward-only.

DROP INDEX IF EXISTS hierarchy_templates_system_template_idx;

ALTER TABLE hierarchy_templates
  DROP COLUMN IF EXISTS system_template_id;
