-- Migration 0195: fast_path_decisions table for classifier shadow-eval logging
-- Phase 3 / Universal Brief (docs/universal-brief-dev-spec.md §5.5)

CREATE TABLE IF NOT EXISTS fast_path_decisions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id             UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  organisation_id      UUID NOT NULL,
  subaccount_id        UUID,
  decided_route        TEXT NOT NULL CHECK (decided_route IN ('simple_reply', 'needs_clarification', 'needs_orchestrator', 'cheap_answer')),
  decided_scope        TEXT NOT NULL CHECK (decided_scope IN ('subaccount', 'org', 'system')),
  decided_confidence   NUMERIC(4,3) NOT NULL,
  decided_tier         INTEGER NOT NULL,
  second_look_triggered BOOLEAN NOT NULL DEFAULT FALSE,
  downstream_outcome   TEXT CHECK (downstream_outcome IN ('proceeded', 're_issued', 'clarified', 'abandoned', 'user_overrode_scope')),
  user_overrode_scope_to TEXT CHECK (user_overrode_scope_to IN ('subaccount', 'org', 'system')),
  decided_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  outcome_at           TIMESTAMPTZ,
  metadata             JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS fast_path_brief_idx     ON fast_path_decisions (brief_id);
CREATE INDEX IF NOT EXISTS fast_path_org_idx       ON fast_path_decisions (organisation_id);
CREATE INDEX IF NOT EXISTS fast_path_route_idx     ON fast_path_decisions (decided_route);
CREATE INDEX IF NOT EXISTS fast_path_decided_at_idx ON fast_path_decisions (decided_at);

-- Row Level Security — matches the 0079 canonical pattern:
-- ENABLE + FORCE RLS, guard session variable for NULL/empty before the ::uuid
-- cast, and set both USING + WITH CHECK so writes are filtered too.
ALTER TABLE fast_path_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fast_path_decisions FORCE ROW LEVEL SECURITY;

CREATE POLICY fast_path_decisions_org_isolation ON fast_path_decisions
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
