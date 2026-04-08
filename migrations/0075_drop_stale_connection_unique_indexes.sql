-- 0075_drop_stale_connection_unique_indexes.sql
--
-- Migration 0052 (org_level_connections) intended to drop the old unique index
-- "integration_connections_subaccount_provider_label" so that multiple connections
-- of the same provider type could be created under the same subaccount (differentiated
-- by label). The DROP CONSTRAINT used the wrong name — the actual index was named
-- "integration_connections_subaccount_provider" (no _label suffix). The IF EXISTS
-- silently no-op'd, leaving the old index intact.
--
-- This migration drops the stale index. The correct partial unique indexes
-- ic_subaccount_provider_label_unique and ic_org_provider_label_unique were already
-- created by 0052 and remain in place.
--
-- Also drops the duplicate org-scoped index "integration_connections_org_provider_unique"
-- which is identical to the already-present "ic_org_provider_label_unique" and was
-- similarly left behind.

DROP INDEX IF EXISTS "integration_connections_subaccount_provider";
DROP INDEX IF EXISTS "integration_connections_org_provider_unique";
