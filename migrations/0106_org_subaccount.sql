-- Migration 0106: Org Subaccount Refactor
--
-- Every organisation gets a default "org subaccount" — a permanently linked,
-- undeletable subaccount that serves as the org's own workspace. All org-level
-- agent execution moves into this subaccount using existing infrastructure.
--
-- Spec: docs/org-subaccount-refactor-spec.md

-- 1. Add isOrgSubaccount column
ALTER TABLE subaccounts
  ADD COLUMN is_org_subaccount BOOLEAN NOT NULL DEFAULT false;

-- 2. Partial unique index: one org subaccount per org
CREATE UNIQUE INDEX subaccounts_org_subaccount_unique_idx
  ON subaccounts (organisation_id)
  WHERE is_org_subaccount = true AND deleted_at IS NULL;

-- 3. Composite index for fast lookup
CREATE INDEX subaccounts_org_hq_idx
  ON subaccounts (organisation_id, is_org_subaccount)
  WHERE is_org_subaccount = true;

-- 4. DB-level invariant constraints
-- Prevent soft-deleting the org subaccount
ALTER TABLE subaccounts
ADD CONSTRAINT org_subaccount_not_deleted
CHECK (NOT (is_org_subaccount = true AND deleted_at IS NOT NULL));

-- Prevent changing status away from 'active'
ALTER TABLE subaccounts
ADD CONSTRAINT org_subaccount_active_only
CHECK (NOT (is_org_subaccount = true AND status != 'active'));

-- 5. Backfill: create org subaccount for every existing org that doesn't have one
--
-- Slug collision strategy: use full UUID to guarantee uniqueness against the
-- existing (organisation_id, slug) unique index. A normal subaccount could
-- already have slug 'org-hq' or 'org-hq-<prefix>', so we use the full
-- generated ID to make collisions impossible. The slug is internal — users
-- see the name ("[Org Name] Workspace"), not the slug.
INSERT INTO subaccounts (id, organisation_id, name, slug, status, is_org_subaccount, include_in_org_inbox, created_at, updated_at)
SELECT
  new_id,
  o.id,
  o.name || ' Workspace',
  'org-hq-' || new_id::text,
  'active',
  true,
  true,
  NOW(),
  NOW()
FROM organisations o
CROSS JOIN LATERAL (SELECT gen_random_uuid() AS new_id) ids
WHERE NOT EXISTS (
  SELECT 1 FROM subaccounts s
  WHERE s.organisation_id = o.id
    AND s.is_org_subaccount = true
    AND s.deleted_at IS NULL
);

-- 6. Migration state tracking table
CREATE TABLE IF NOT EXISTS migration_states (
  key TEXT PRIMARY KEY,
  completed_at TIMESTAMPTZ,
  metadata JSONB
);

-- Record schema migration completion
INSERT INTO migration_states (key, completed_at, metadata)
VALUES ('org_subaccount_schema', NOW(), '{"migration": "0106_org_subaccount"}')
ON CONFLICT (key) DO UPDATE SET completed_at = NOW();
