-- Add manifest_hash and parser_version to both template tables
-- for import idempotency and reproducibility tracking.

ALTER TABLE system_hierarchy_templates
  ADD COLUMN manifest_hash text,
  ADD COLUMN parser_version text;

ALTER TABLE hierarchy_templates
  ADD COLUMN manifest_hash text,
  ADD COLUMN parser_version text;

-- Unique constraint on manifest_hash to prevent race-condition duplicates.
-- Application-level check (409) handles the happy path; this catches concurrent inserts.
-- Scoped to non-deleted, non-null hashes so soft-deleted templates don't block re-import.
CREATE UNIQUE INDEX system_hierarchy_templates_manifest_hash_uniq
  ON system_hierarchy_templates (manifest_hash)
  WHERE manifest_hash IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX hierarchy_templates_manifest_hash_org_uniq
  ON hierarchy_templates (organisation_id, manifest_hash)
  WHERE manifest_hash IS NOT NULL AND deleted_at IS NULL;
