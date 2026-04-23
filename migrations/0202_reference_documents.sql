-- 0202_reference_documents.sql
--
-- Cached Context Infrastructure Phase 1: reference_documents table.
-- One row per user-uploaded reference document. Content lives in
-- reference_document_versions (migration 0203). This row is the stable
-- identity + current-version pointer.
--
-- See docs/cached-context-infrastructure-spec.md §5.1

CREATE TABLE reference_documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     uuid NOT NULL REFERENCES organisations(id),
  subaccount_id       uuid REFERENCES subaccounts(id),

  name                text NOT NULL,
  description         text,

  -- Soft FK to reference_document_versions.id — FK constraint added in 0203
  -- to avoid circular dependency (same pattern as memory_blocks.activeVersionId).
  current_version_id  uuid,
  current_version     integer NOT NULL DEFAULT 0,

  -- Deferred v2 connector fields — v1 only writes 'manual'.
  source_type         text NOT NULL DEFAULT 'manual',
  source_ref          text,
  last_synced_at      timestamptz,

  -- Lifecycle flags.
  paused_at           timestamptz,
  deprecated_at       timestamptz,
  deprecation_reason  text,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

-- Unique name per org (soft-deleted docs don't count).
CREATE UNIQUE INDEX reference_documents_org_name_uq
  ON reference_documents (organisation_id, name)
  WHERE deleted_at IS NULL;

CREATE INDEX reference_documents_org_idx
  ON reference_documents (organisation_id);

CREATE INDEX reference_documents_subaccount_idx
  ON reference_documents (subaccount_id)
  WHERE subaccount_id IS NOT NULL;

-- Fast lookup of active (non-deleted, non-deprecated, non-paused) docs.
CREATE INDEX reference_documents_active_idx
  ON reference_documents (organisation_id, subaccount_id)
  WHERE deleted_at IS NULL AND deprecated_at IS NULL AND paused_at IS NULL;

-- ── RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE reference_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY reference_documents_org_isolation ON reference_documents
  USING (organisation_id = current_setting('app.current_organisation_id', true)::uuid);

CREATE POLICY reference_documents_subaccount_isolation ON reference_documents
  USING (
    subaccount_id IS NULL
    OR subaccount_id = current_setting('app.current_subaccount_id', true)::uuid
  );

-- ── Permissions ───────────────────────────────────────────────────────────

INSERT INTO permissions (key, description, group_name)
VALUES
  ('reference_documents.read',       'View reference documents and their versions',                  'reference_documents'),
  ('reference_documents.write',      'Create, edit, rename, pause, resume, and soft-delete reference documents', 'reference_documents'),
  ('reference_documents.deprecate',  'Deprecate reference documents (forward-only lifecycle action)', 'reference_documents')
ON CONFLICT (key) DO NOTHING;

-- Backfill: grant reference_documents.read to anyone who can already view the workspace.
INSERT INTO permission_set_items (permission_set_id, permission_key)
SELECT DISTINCT psi.permission_set_id, 'reference_documents.read'
FROM permission_set_items psi
WHERE psi.permission_key = 'org.workspace.view'
  AND NOT EXISTS (
    SELECT 1 FROM permission_set_items e
    WHERE e.permission_set_id = psi.permission_set_id
      AND e.permission_key = 'reference_documents.read'
  );

-- Backfill: grant reference_documents.write to anyone who can already manage workspace content.
INSERT INTO permission_set_items (permission_set_id, permission_key)
SELECT DISTINCT psi.permission_set_id, 'reference_documents.write'
FROM permission_set_items psi
WHERE psi.permission_key = 'org.workspace.manage'
  AND NOT EXISTS (
    SELECT 1 FROM permission_set_items e
    WHERE e.permission_set_id = psi.permission_set_id
      AND e.permission_key = 'reference_documents.write'
  );
