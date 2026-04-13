-- GEO (Generative Engine Optimisation) audit results
-- Stores composite and per-dimension GEO scores per URL/subaccount.
-- Historical rows enable trend tracking across audits.

CREATE TABLE IF NOT EXISTS geo_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  subaccount_id UUID REFERENCES subaccounts(id),

  -- What was audited
  url TEXT NOT NULL,
  page_title TEXT,

  -- Composite score (weighted sum of dimension scores, 0-100)
  composite_score REAL NOT NULL,

  -- Per-dimension breakdown (JSONB array of {dimension, score, weight, findings, recommendations})
  dimension_scores JSONB NOT NULL,

  -- Platform-specific readiness scores (JSONB array)
  platform_readiness JSONB,

  -- Priority-ranked recommendations (JSONB string array)
  recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Which agent run produced this audit (nullable for manual/API runs)
  agent_run_id UUID,

  -- Audit metadata
  audit_type TEXT NOT NULL DEFAULT 'full',
  competitor_urls JSONB,

  -- Dimension weights snapshot (reproducible historical scores)
  weights_snapshot JSONB NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot-path indexes
CREATE INDEX IF NOT EXISTS geo_audits_org_idx ON geo_audits(organisation_id);
CREATE INDEX IF NOT EXISTS geo_audits_subaccount_idx ON geo_audits(subaccount_id);
CREATE INDEX IF NOT EXISTS geo_audits_url_idx ON geo_audits(organisation_id, url);
CREATE INDEX IF NOT EXISTS geo_audits_created_at_idx ON geo_audits(organisation_id, created_at);
