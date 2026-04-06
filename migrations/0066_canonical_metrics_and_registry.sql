-- Canonical Metrics: derived metrics computed by adapters
CREATE TABLE IF NOT EXISTS canonical_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  account_id UUID NOT NULL REFERENCES canonical_accounts(id) ON DELETE CASCADE,
  metric_slug TEXT NOT NULL,
  current_value NUMERIC NOT NULL,
  previous_value NUMERIC,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  period_type TEXT NOT NULL,
  aggregation_type TEXT NOT NULL,
  unit TEXT,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  computation_trigger TEXT NOT NULL,
  connector_type TEXT NOT NULL,
  metric_version INTEGER NOT NULL DEFAULT 1,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS canonical_metrics_account_metric_unique
  ON canonical_metrics (account_id, metric_slug, period_type, aggregation_type);
CREATE INDEX IF NOT EXISTS canonical_metrics_org_metric_idx
  ON canonical_metrics (organisation_id, metric_slug);
CREATE INDEX IF NOT EXISTS canonical_metrics_account_time_idx
  ON canonical_metrics (account_id, computed_at DESC);

-- Canonical Metric History: append-only for baseline computation
CREATE TABLE IF NOT EXISTS canonical_metric_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  account_id UUID NOT NULL REFERENCES canonical_accounts(id) ON DELETE CASCADE,
  metric_slug TEXT NOT NULL,
  period_type TEXT NOT NULL,
  aggregation_type TEXT NOT NULL,
  value NUMERIC NOT NULL,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metric_version INTEGER NOT NULL DEFAULT 1,
  is_backfill BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS canonical_metric_history_baseline_idx
  ON canonical_metric_history (account_id, metric_slug, period_type, computed_at DESC);
CREATE INDEX IF NOT EXISTS canonical_metric_history_org_idx
  ON canonical_metric_history (organisation_id);
CREATE UNIQUE INDEX IF NOT EXISTS canonical_metric_history_dedup_idx
  ON canonical_metric_history (account_id, metric_slug, period_type, period_start, period_end);

-- Metric Definitions: soft registry for adapter-defined metrics
CREATE TABLE IF NOT EXISTS metric_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_slug TEXT NOT NULL,
  connector_type TEXT NOT NULL,
  label TEXT,
  unit TEXT,
  value_type TEXT,
  default_period_type TEXT,
  default_aggregation_type TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  depends_on JSONB,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS metric_definitions_connector_slug_unique
  ON metric_definitions (connector_type, metric_slug);

-- Add algorithm_version to health_snapshots
ALTER TABLE health_snapshots ADD COLUMN IF NOT EXISTS algorithm_version TEXT;

-- Add algorithm_version and config_version to anomaly_events
ALTER TABLE anomaly_events ADD COLUMN IF NOT EXISTS algorithm_version TEXT;
ALTER TABLE anomaly_events ADD COLUMN IF NOT EXISTS config_version TEXT;
