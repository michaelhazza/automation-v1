-- Migration 0096: workspace_health_findings (Brain Tree OS adoption P4)
-- Stores findings produced by the workspace health audit detectors.
-- See docs/brain-tree-os-adoption-spec.md §P4 for the schema rationale.

CREATE TABLE workspace_health_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  detector text NOT NULL,
  severity text NOT NULL,                        -- 'info' | 'warning' | 'critical'
  resource_kind text NOT NULL,                   -- 'agent' | 'subaccount_agent' | 'process' | 'subaccount' | 'org'
  resource_id uuid NOT NULL,
  resource_label text NOT NULL,
  message text NOT NULL,
  recommendation text NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  -- One row per (org, detector, resource) so re-running the audit is an
  -- in-place upsert; the runner relies on this to keep the table bounded.
  CONSTRAINT workspace_health_findings_unique UNIQUE (organisation_id, detector, resource_id)
);

-- Active findings index — supports the "show me critical findings for this org" hot path
CREATE INDEX wh_org_severity_idx
  ON workspace_health_findings (organisation_id, severity)
  WHERE resolved_at IS NULL;

-- Resource-level lookup — supports "what findings are open against this resource"
CREATE INDEX wh_resource_idx
  ON workspace_health_findings (resource_kind, resource_id);
