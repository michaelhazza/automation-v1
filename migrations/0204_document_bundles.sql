-- 0204_document_bundles.sql
--
-- Cached Context Infrastructure Phase 1: document_bundles table.
-- One row per bundle. Bundles are the backend attachment unit.
-- is_auto_created distinguishes implicit (unnamed) from named bundles.
--
-- See docs/cached-context-infrastructure-spec.md §5.3

CREATE TABLE document_bundles (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id             uuid NOT NULL REFERENCES organisations(id),
  subaccount_id               uuid REFERENCES subaccounts(id),

  -- NULL iff is_auto_created=true. Non-null iff is_auto_created=false.
  -- Enforced by CHECK constraint below.
  name                        text,
  description                 text,

  is_auto_created             boolean NOT NULL DEFAULT true,

  created_by_user_id          uuid NOT NULL REFERENCES users(id),

  current_version             integer NOT NULL DEFAULT 1,

  -- Job-computed utilization metrics keyed by model family.
  -- Written by bundleUtilizationJob (Phase 2 chunk 2.7, enabled Phase 6).
  utilization_by_model_family jsonb,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  deleted_at                  timestamptz
);

-- Named-bundle name uniqueness per org (unnamed bundles excluded via predicate).
CREATE UNIQUE INDEX document_bundles_org_name_uq
  ON document_bundles (organisation_id, name)
  WHERE deleted_at IS NULL AND name IS NOT NULL;

CREATE INDEX document_bundles_org_idx
  ON document_bundles (organisation_id);

CREATE INDEX document_bundles_subaccount_idx
  ON document_bundles (subaccount_id)
  WHERE subaccount_id IS NOT NULL;

-- Fast lookup of named bundles in the UI picker / bundles list.
CREATE INDEX document_bundles_named_lookup_idx
  ON document_bundles (organisation_id, subaccount_id)
  WHERE deleted_at IS NULL AND is_auto_created = false;

-- Enforce the named vs unnamed invariant at the DB level.
ALTER TABLE document_bundles
  ADD CONSTRAINT document_bundles_name_matches_auto_flag
  CHECK (
    (is_auto_created = true  AND name IS NULL) OR
    (is_auto_created = false AND name IS NOT NULL AND length(trim(name)) > 0)
  );

-- ── RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE document_bundles ENABLE ROW LEVEL SECURITY;

CREATE POLICY document_bundles_org_isolation ON document_bundles
  USING (organisation_id = current_setting('app.current_organisation_id', true)::uuid);

CREATE POLICY document_bundles_subaccount_isolation ON document_bundles
  USING (
    subaccount_id IS NULL
    OR subaccount_id = current_setting('app.current_subaccount_id', true)::uuid
  );

-- ── Permissions ───────────────────────────────────────────────────────────

INSERT INTO permissions (key, description, group_name)
VALUES
  ('document_bundles.read',   'View document bundles and their members',                        'document_bundles'),
  ('document_bundles.write',  'Create, edit, promote, and delete document bundles',              'document_bundles'),
  ('document_bundles.attach', 'Attach document bundles to agents, tasks, and scheduled tasks',  'document_bundles')
ON CONFLICT (key) DO NOTHING;

-- Backfill: grant document_bundles.read to anyone who can already view the workspace.
INSERT INTO permission_set_items (permission_set_id, permission_key)
SELECT DISTINCT psi.permission_set_id, 'document_bundles.read'
FROM permission_set_items psi
WHERE psi.permission_key = 'org.workspace.view'
  AND NOT EXISTS (
    SELECT 1 FROM permission_set_items e
    WHERE e.permission_set_id = psi.permission_set_id
      AND e.permission_key = 'document_bundles.read'
  );

-- Backfill: grant document_bundles.write + attach to anyone who can manage workspace content.
INSERT INTO permission_set_items (permission_set_id, permission_key)
SELECT DISTINCT psi.permission_set_id, 'document_bundles.write'
FROM permission_set_items psi
WHERE psi.permission_key = 'org.workspace.manage'
  AND NOT EXISTS (
    SELECT 1 FROM permission_set_items e
    WHERE e.permission_set_id = psi.permission_set_id
      AND e.permission_key = 'document_bundles.write'
  );

INSERT INTO permission_set_items (permission_set_id, permission_key)
SELECT DISTINCT psi.permission_set_id, 'document_bundles.attach'
FROM permission_set_items psi
WHERE psi.permission_key = 'org.workspace.manage'
  AND NOT EXISTS (
    SELECT 1 FROM permission_set_items e
    WHERE e.permission_set_id = psi.permission_set_id
      AND e.permission_key = 'document_bundles.attach'
  );
