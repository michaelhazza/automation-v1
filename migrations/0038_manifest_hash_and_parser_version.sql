-- Add manifest_hash and parser_version to both template tables
-- for import idempotency and reproducibility tracking.

ALTER TABLE system_hierarchy_templates
  ADD COLUMN manifest_hash text,
  ADD COLUMN parser_version text;

ALTER TABLE hierarchy_templates
  ADD COLUMN manifest_hash text,
  ADD COLUMN parser_version text;

-- Index on manifest_hash for fast duplicate lookups (only non-null values)
CREATE INDEX system_hierarchy_templates_manifest_hash_idx
  ON system_hierarchy_templates (manifest_hash)
  WHERE manifest_hash IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX hierarchy_templates_manifest_hash_idx
  ON hierarchy_templates (manifest_hash)
  WHERE manifest_hash IS NOT NULL AND deleted_at IS NULL;
