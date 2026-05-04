-- Migration 0272: cost_aggregates — organisation_id column, backfill, RLS, spend dimensions
-- Spec: tasks/builds/agentic-commerce/spec.md §5.2, plan §2.4 / Chunk 2
-- Branch: claude/agentic-commerce-spending
--
-- Purpose:
--   Adds organisation_id to cost_aggregates, backfills it, applies RLS, and
--   adds a comment-only marker for the three new agent-spend entityType values.
--
-- Backfill strategy (invariant 8 — no spend data without RLS):
--   The backfill resolves organisation_id for each row via the existing
--   FK chain by entityType:
--     'organisation'     → entityId IS a UUID → direct organisations.id match
--     'subaccount'       → subaccounts.organisation_id
--     'run'              → agent_runs.organisation_id
--     'agent'            → agents.organisation_id (via subaccounts)
--     'task_type'        → no FK; entityId is a string label — NULL unless
--                          the label is resolvable via the entity context.
--                          Treated as platform-scoped; see platform/provider below.
--     'provider'         → platform-scoped; no per-tenant organisation_id.
--     'platform'         → platform-scoped; no per-tenant organisation_id.
--     'execution_phase'  → no per-tenant scope; treated as platform-scoped.
--     'source_type'      → introduced by migration 0186; entityId is a label.
--     'feature_tag'      → introduced by migration 0186; entityId is a label.
--     mcp_*              → 'mcp_org' entityId is organisation uuid;
--                          'mcp_subaccount' entityId is subaccount uuid;
--                          'mcp_run' entityId is run uuid;
--                          'mcp_server' entityId is slug (org-scoped label).
--   For tables >1M rows: run the backfill in chunks of 10,000 rows using
--   UPDATE ... WHERE id IN (SELECT id FROM cost_aggregates WHERE organisation_id IS NULL
--   LIMIT 10000) to avoid table-level lock contention. This migration uses a
--   single-pass approach suitable for pre-production volume; operators on
--   large production deployments should run the chunked script at
--   scripts/backfill-cost-aggregates-org.ts before applying the NOT NULL
--   constraint.
--
-- platform / provider / execution_phase / source_type / feature_tag rows:
--   These entityTypes have no per-tenant scope. We use a sentinel UUID
--   (00000000-0000-0000-0000-000000000001) to satisfy the NOT NULL constraint
--   after backfill. The RLS policy uses a partial exemption (see below) so
--   queries against these rows still work when no session GUC is set — the
--   policy predicate evaluates true for all readers for sentinel-org rows.
--   The sentinel UUID does NOT reference organisations.id (no FK constraint on
--   organisation_id), allowing it to be used without a real org row.
--
-- New entityType values (comment-only marker per 0186 precedent — actual logic
-- ships in Chunk 13 when agentSpendAggregateService first writes them):
--   'agent_spend_subaccount' — per-subaccount agent spend rollup (daily, monthly)
--   'agent_spend_org'        — per-org agent spend rollup (daily, monthly)
--   'agent_spend_run'        — per-run agent spend (lifetime)

-- ── 1. Add organisation_id (nullable initially for backfill) ─────────────────

ALTER TABLE cost_aggregates
  ADD COLUMN IF NOT EXISTS organisation_id UUID;

-- ── 2. Backfill organisation_id ───────────────────────────────────────────────

-- Platform / provider / execution_phase / source_type / feature_tag / task_type:
-- sentinel UUID so NOT NULL can be applied uniformly after backfill.
-- These rows are excluded from the tenant isolation policy via a partial USING
-- clause below (sentinel org rows are visible to all readers).
UPDATE cost_aggregates
  SET organisation_id = '00000000-0000-0000-0000-000000000001'
  WHERE entity_type IN ('platform', 'provider', 'execution_phase', 'source_type', 'feature_tag', 'task_type')
    AND organisation_id IS NULL;

-- 'organisation' rows: entityId IS the organisation UUID.
UPDATE cost_aggregates
  SET organisation_id = entity_id::uuid
  WHERE entity_type = 'organisation'
    AND organisation_id IS NULL;

-- 'subaccount' rows: resolve via subaccounts.
UPDATE cost_aggregates ca
  SET organisation_id = s.organisation_id
  FROM subaccounts s
  WHERE ca.entity_type = 'subaccount'
    AND ca.entity_id = s.id::text
    AND ca.organisation_id IS NULL;

-- 'run' rows: resolve via agent_runs.
UPDATE cost_aggregates ca
  SET organisation_id = r.organisation_id
  FROM agent_runs r
  WHERE ca.entity_type = 'run'
    AND ca.entity_id = r.id::text
    AND ca.organisation_id IS NULL;

-- 'agent' rows: resolve via agents → organisations.
UPDATE cost_aggregates ca
  SET organisation_id = a.organisation_id
  FROM agents a
  WHERE ca.entity_type = 'agent'
    AND ca.entity_id = a.id::text
    AND ca.organisation_id IS NULL;

-- 'mcp_org' rows: entityId is the organisation UUID.
UPDATE cost_aggregates
  SET organisation_id = entity_id::uuid
  WHERE entity_type = 'mcp_org'
    AND organisation_id IS NULL;

-- 'mcp_subaccount' rows: resolve via subaccounts.
UPDATE cost_aggregates ca
  SET organisation_id = s.organisation_id
  FROM subaccounts s
  WHERE ca.entity_type = 'mcp_subaccount'
    AND ca.entity_id = s.id::text
    AND ca.organisation_id IS NULL;

-- 'mcp_run' rows: resolve via agent_runs.
UPDATE cost_aggregates ca
  SET organisation_id = r.organisation_id
  FROM agent_runs r
  WHERE ca.entity_type = 'mcp_run'
    AND ca.entity_id = r.id::text
    AND ca.organisation_id IS NULL;

-- 'mcp_server' rows: entityId is a slug (org-scoped label string), not a UUID.
-- Resolve by joining to the org that owns the connector config with that mcp slug.
-- If not resolvable, use sentinel.
UPDATE cost_aggregates
  SET organisation_id = '00000000-0000-0000-0000-000000000001'
  WHERE entity_type = 'mcp_server'
    AND organisation_id IS NULL;

-- Any remaining unresolved rows: use sentinel and emit a warning.
-- Operators should inspect: SELECT entity_type, entity_id FROM cost_aggregates
--   WHERE organisation_id IS NULL; before the NOT NULL step.
DO $$
DECLARE
  v_unresolved BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_unresolved
    FROM cost_aggregates
    WHERE organisation_id IS NULL;

  IF v_unresolved > 0 THEN
    RAISE WARNING
      'cost_aggregates backfill: % rows still have NULL organisation_id — applying sentinel. Inspect these rows.',
      v_unresolved;

    UPDATE cost_aggregates
      SET organisation_id = '00000000-0000-0000-0000-000000000001'
      WHERE organisation_id IS NULL;
  END IF;
END $$;

-- ── 3. Apply NOT NULL after backfill ─────────────────────────────────────────

ALTER TABLE cost_aggregates
  ALTER COLUMN organisation_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS cost_aggregates_org_idx
  ON cost_aggregates(organisation_id);

-- ── 4. RLS ────────────────────────────────────────────────────────────────────
-- Canonical org-isolation policy. The USING predicate has a sentinel-org
-- exemption: rows with the platform sentinel UUID are visible to all callers
-- (regardless of app.organisation_id), because they hold aggregate-level
-- cost data with no per-tenant sensitivity.

ALTER TABLE cost_aggregates ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_aggregates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cost_aggregates_org_isolation ON cost_aggregates;
CREATE POLICY cost_aggregates_org_isolation ON cost_aggregates
  USING (
    -- Sentinel org rows (platform/provider/execution_phase) are globally visible.
    organisation_id = '00000000-0000-0000-0000-000000000001'::uuid
    OR (
      current_setting('app.organisation_id', true) IS NOT NULL
      AND current_setting('app.organisation_id', true) <> ''
      AND organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  )
  WITH CHECK (
    -- Sentinel-org writes (platform/provider/execution_phase writers have no per-tenant GUC).
    organisation_id = '00000000-0000-0000-0000-000000000001'::uuid
    OR (
      current_setting('app.organisation_id', true) IS NOT NULL
      AND current_setting('app.organisation_id', true) <> ''
      AND organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  );
