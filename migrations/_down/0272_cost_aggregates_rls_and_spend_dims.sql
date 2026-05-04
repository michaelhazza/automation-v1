-- Down migration for 0272_cost_aggregates_rls_and_spend_dims.sql

-- Remove RLS policy
DROP POLICY IF EXISTS cost_aggregates_org_isolation ON cost_aggregates;
ALTER TABLE cost_aggregates DISABLE ROW LEVEL SECURITY;

-- Remove index
DROP INDEX IF EXISTS cost_aggregates_org_idx;

-- Remove column (loses backfill data; down migration is for dev rollback only)
ALTER TABLE cost_aggregates DROP COLUMN IF EXISTS organisation_id;
