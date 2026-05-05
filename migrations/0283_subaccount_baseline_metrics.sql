-- F3 §3 — per-metric rows, one row per (baseline, metric_slug). PK enforces
-- idempotent re-capture via ON CONFLICT (baseline_id, metric_slug) DO UPDATE.
CREATE TABLE subaccount_baseline_metrics (
  baseline_id UUID NOT NULL REFERENCES subaccount_baselines(id) ON DELETE CASCADE,
  metric_slug TEXT NOT NULL,
  value JSONB NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('canonical_metric', 'manual', 'unavailable')),
  unavailable_reason TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (baseline_id, metric_slug)
);

CREATE INDEX subaccount_baseline_metrics_slug_idx
  ON subaccount_baseline_metrics(metric_slug);
