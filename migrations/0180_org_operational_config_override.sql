-- 0180_org_operational_config_override.sql
-- Session 1 / Chunk A.1 — data-model separation for operational config.
--
-- Per spec §2 (tasks/builds/clientpulse/session-1-foundation-spec.md): the
-- organisation becomes the single owner of operational-config overrides; the
-- hierarchy_templates.operational_config column is retired as a runtime source
-- and preserved as a one-time informational seed on adoption.
--
-- Net effect (contract (h), locked in §1.3):
--   organisations.operational_config_override       — new, org-owned writable overrides
--   organisations.applied_system_template_id        — explicit FK to adopted system template
--   hierarchy_templates.operational_config_seed     — renamed from operational_config,
--                                                     one-time seed, never read at runtime

BEGIN;

-- 1. Add the new operational-config override column.
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS operational_config_override jsonb;

-- 2. Add the org-level FK to the adopted system template. Nullable because
--    pre-existing orgs may not have an explicit linkage yet; step 3 backfills
--    from the current implicit linkage via hierarchy_templates.system_template_id.
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS applied_system_template_id uuid
    REFERENCES system_hierarchy_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS organisations_applied_system_template_id_idx
  ON organisations (applied_system_template_id)
  WHERE applied_system_template_id IS NOT NULL;

-- 3. Backfill the FK from the current implicit linkage. Deterministic tie-break
--    via ORDER BY updated_at DESC — today's orgConfigService.getOperationalConfig
--    uses LIMIT 1 without ORDER BY; the migration locks every org to the
--    most-recently-updated candidate, which is a slight hardening of runtime
--    behaviour (see spec §2.4 for rationale).
WITH resolved_link AS (
  SELECT DISTINCT ON (ht.organisation_id)
    ht.organisation_id, ht.system_template_id
  FROM hierarchy_templates ht
  WHERE ht.system_template_id IS NOT NULL
    AND ht.deleted_at IS NULL
  ORDER BY ht.organisation_id, ht.updated_at DESC
)
UPDATE organisations o
SET applied_system_template_id = rl.system_template_id
FROM resolved_link rl
WHERE o.id = rl.organisation_id
  AND o.applied_system_template_id IS NULL;

-- 4. Backfill the override column: copy each org's existing
--    hierarchy_templates.operational_config into the new column, using the same
--    ORDER BY updated_at DESC tie-break as step 3 (see §2.4).
WITH resolved_tpl AS (
  SELECT DISTINCT ON (ht.organisation_id)
    ht.organisation_id, ht.operational_config
  FROM hierarchy_templates ht
  WHERE ht.system_template_id IS NOT NULL
    AND ht.deleted_at IS NULL
    AND ht.operational_config IS NOT NULL
  ORDER BY ht.organisation_id, ht.updated_at DESC
)
UPDATE organisations o
SET operational_config_override = rt.operational_config
FROM resolved_tpl rt
WHERE o.id = rt.organisation_id
  AND o.operational_config_override IS NULL;

-- 5. Rename the template column so the intent is clear + stop accidental writes
--    from code that still thinks it's the runtime column.
ALTER TABLE hierarchy_templates
  RENAME COLUMN operational_config TO operational_config_seed;

-- 6. Deprecation markers — comments on both columns make the intent discoverable
--    in psql + ORM introspection.
COMMENT ON COLUMN organisations.operational_config_override IS
  'Org-level runtime operational config. Single source of truth. Written by config_update_organisation_config skill + ClientPulse Settings page. Deep-merged with system_hierarchy_templates.operational_defaults at read time.';
COMMENT ON COLUMN hierarchy_templates.operational_config_seed IS
  'One-time informational snapshot copied from system_hierarchy_templates.operational_defaults when this blueprint is adopted. NOT a runtime source; organisations.operational_config_override remains NULL on newly-created orgs until the first explicit edit, and effective config is derived by deep-merging system_hierarchy_templates.operational_defaults with organisations.operational_config_override at read time.';

COMMIT;
