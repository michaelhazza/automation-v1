-- Migration: Org-level integration connections
-- Replaces the single unique constraint with two partial unique indexes:
-- 1. Subaccount-scoped connections: unique per (subaccount, provider, label)
-- 2. Org-scoped connections: unique per (org, provider, label) when subaccountId IS NULL

-- Drop the old constraint that prevents org-level connections (NULL subaccountId)
ALTER TABLE "integration_connections"
  DROP CONSTRAINT IF EXISTS "integration_connections_subaccount_provider_label";

-- Subaccount-scoped: unique per (subaccount, provider, label) when subaccountId IS NOT NULL
CREATE UNIQUE INDEX IF NOT EXISTS "ic_subaccount_provider_label_unique"
  ON "integration_connections" ("subaccount_id", "provider_type", "label")
  WHERE "subaccount_id" IS NOT NULL;

-- Org-scoped: unique per (org, provider, label) when subaccountId IS NULL
CREATE UNIQUE INDEX IF NOT EXISTS "ic_org_provider_label_unique"
  ON "integration_connections" ("organisation_id", "provider_type", "label")
  WHERE "subaccount_id" IS NULL;
