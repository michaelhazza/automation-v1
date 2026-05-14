-- Migration 0267: agent_recommendations table + RLS + subaccounts.optimiser_enabled column
-- Spec: docs/sub-account-optimiser-spec.md §6.1 + §4
-- Branch: claude/subaccount-optimiser
-- All are conceptually owned by the optimiser feature (spec §9 Phase 0).

-- ── agent_recommendations table ──────────────────────────────────────────────

CREATE TABLE agent_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('org', 'subaccount')),
  scope_id UUID NOT NULL,
  producing_agent_id UUID NOT NULL REFERENCES agents(id),
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'critical')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_hash TEXT NOT NULL DEFAULT '',
  action_hint TEXT,
  dedupe_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  dismissed_reason TEXT,
  dismissed_until TIMESTAMPTZ
);

-- Partial unique index on (scope, category, dedupe_key) for open recs only.
-- WHERE dismissed_at IS NULL per DEVELOPMENT_GUIDELINES §3 soft-delete-unique rule.
CREATE UNIQUE INDEX agent_recommendations_dedupe
  ON agent_recommendations(scope_type, scope_id, category, dedupe_key)
  WHERE dismissed_at IS NULL;

-- Index for fetching open (non-dismissed, non-acknowledged) recs by scope, sorted by recency.
CREATE INDEX agent_recommendations_open_by_scope
  ON agent_recommendations(scope_type, scope_id, updated_at DESC)
  WHERE dismissed_at IS NULL AND acknowledged_at IS NULL;

-- Index for cooldown lookup: dismissed recs with an active cooldown window.
CREATE INDEX agent_recommendations_dismissed_active_cooldown
  ON agent_recommendations(scope_type, scope_id, category, dedupe_key, dismissed_until)
  WHERE dismissed_at IS NOT NULL;

-- Index for org-level rollup queries.
CREATE INDEX agent_recommendations_org
  ON agent_recommendations(organisation_id, created_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE agent_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_recommendations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_recommendations_org_isolation ON agent_recommendations;
CREATE POLICY agent_recommendations_org_isolation ON agent_recommendations
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ── subaccounts.optimiser_enabled column ─────────────────────────────────────
-- Default-on: every sub-account participates in daily optimiser scans unless opted out.
-- Opt-out is a backend boolean column (spec §4). No UI toggle in v1.

ALTER TABLE subaccounts ADD COLUMN optimiser_enabled BOOLEAN NOT NULL DEFAULT true;
