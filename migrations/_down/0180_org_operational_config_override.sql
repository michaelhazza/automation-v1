-- 0180_org_operational_config_override.sql — rollback
--
-- Reverses migration 0180. Per spec §8.8 (rollback plan), any writes that land
-- in organisations.operational_config_override AFTER the forward migration are
-- NOT mirrored back into hierarchy_templates.operational_config_seed; a straight
-- _down drops those writes. Acceptable under the current pre-production
-- framing (docs/spec-context.md: live_users=no, rollout_model=commit_and_revert).

BEGIN;

-- 1. Drop the override-column column comment (idempotent via COMMENT ... IS NULL).
COMMENT ON COLUMN organisations.operational_config_override IS NULL;
COMMENT ON COLUMN hierarchy_templates.operational_config_seed IS NULL;

-- 2. Rename the template column back to its original name. Data is preserved.
ALTER TABLE hierarchy_templates
  RENAME COLUMN operational_config_seed TO operational_config;

-- 3. Drop the partial index on applied_system_template_id.
DROP INDEX IF EXISTS organisations_applied_system_template_id_idx;

-- 4. Drop the FK + column. ON DELETE SET NULL FK is dropped transparently with the column.
ALTER TABLE organisations
  DROP COLUMN IF EXISTS applied_system_template_id;

-- 5. Drop the override column.
ALTER TABLE organisations
  DROP COLUMN IF EXISTS operational_config_override;

COMMIT;
