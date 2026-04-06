-- 0061_webhook_adapter_branding_governance.sql
-- Feature 7: HTTP/Webhook Agent Adapter
-- Feature 11: Per-Org Branding
-- Feature 12: Agent Hiring Approval Gate
-- CC-10: Audit correlationId

CREATE TABLE webhook_adapter_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) UNIQUE,
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  endpoint_url TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'none',
  auth_secret TEXT,
  auth_header_name TEXT,
  timeout_ms INTEGER NOT NULL DEFAULT 300000,
  retry_count INTEGER NOT NULL DEFAULT 2,
  retry_backoff_ms INTEGER NOT NULL DEFAULT 5000,
  expect_callback BOOLEAN NOT NULL DEFAULT false,
  callback_secret TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Branding columns on organisations
ALTER TABLE organisations
  ADD COLUMN logo_url TEXT,
  ADD COLUMN brand_color TEXT,
  ADD COLUMN require_agent_approval BOOLEAN NOT NULL DEFAULT false;

-- Audit event correlation
ALTER TABLE audit_events
  ADD COLUMN correlation_id TEXT;
CREATE INDEX audit_events_correlation_idx ON audit_events(correlation_id);
