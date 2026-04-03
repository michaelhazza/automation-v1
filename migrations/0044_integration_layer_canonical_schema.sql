-- Migration 0044: Integration layer canonical schema
-- Enables external platform data ingestion, normalisation, and health tracking.
-- Part of Phase 2: Integration Layer + GHL Connector

-- =============================================================================
-- 1. Connector Configs — per-org connector configuration
-- =============================================================================

CREATE TABLE connector_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  connector_type text NOT NULL,
  connection_id uuid REFERENCES integration_connections(id),
  config_json jsonb,
  status text NOT NULL DEFAULT 'active',
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  poll_interval_minutes integer NOT NULL DEFAULT 60,
  webhook_secret text,
  sync_phase text NOT NULL DEFAULT 'backfill',
  config_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organisation_id, connector_type)
);

CREATE INDEX connector_configs_org_idx ON connector_configs (organisation_id);
CREATE INDEX connector_configs_status_idx ON connector_configs (status);

-- =============================================================================
-- 2. Canonical Accounts — external platform accounts mapped to subaccounts
-- =============================================================================

CREATE TABLE canonical_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  connector_config_id uuid NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,
  subaccount_id uuid REFERENCES subaccounts(id),
  external_id text NOT NULL,
  display_name text,
  status text NOT NULL DEFAULT 'active',
  external_metadata jsonb,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (connector_config_id, external_id)
);

CREATE INDEX canonical_accounts_org_idx ON canonical_accounts (organisation_id);
CREATE INDEX canonical_accounts_connector_idx ON canonical_accounts (connector_config_id);
CREATE INDEX canonical_accounts_subaccount_idx ON canonical_accounts (subaccount_id);

-- =============================================================================
-- 3. Canonical Contacts
-- =============================================================================

CREATE TABLE canonical_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  account_id uuid NOT NULL REFERENCES canonical_accounts(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  first_name text,
  last_name text,
  email text,
  phone text,
  tags jsonb,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  external_created_at timestamptz,

  UNIQUE (account_id, external_id)
);

CREATE INDEX canonical_contacts_account_idx ON canonical_contacts (account_id);
CREATE INDEX canonical_contacts_org_idx ON canonical_contacts (organisation_id);

-- =============================================================================
-- 4. Canonical Opportunities
-- =============================================================================

CREATE TABLE canonical_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  account_id uuid NOT NULL REFERENCES canonical_accounts(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  name text,
  stage text,
  value numeric,
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'open',
  stage_entered_at timestamptz,
  stage_history jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  external_created_at timestamptz,

  UNIQUE (account_id, external_id)
);

CREATE INDEX canonical_opportunities_account_idx ON canonical_opportunities (account_id);
CREATE INDEX canonical_opportunities_org_idx ON canonical_opportunities (organisation_id);
CREATE INDEX canonical_opportunities_status_idx ON canonical_opportunities (account_id, status);

-- =============================================================================
-- 5. Canonical Conversations
-- =============================================================================

CREATE TABLE canonical_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  account_id uuid NOT NULL REFERENCES canonical_accounts(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  channel text NOT NULL DEFAULT 'other',
  status text NOT NULL DEFAULT 'active',
  message_count integer NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  last_response_time_seconds integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  external_created_at timestamptz,

  UNIQUE (account_id, external_id)
);

CREATE INDEX canonical_conversations_account_idx ON canonical_conversations (account_id);
CREATE INDEX canonical_conversations_org_idx ON canonical_conversations (organisation_id);

-- =============================================================================
-- 6. Canonical Revenue
-- =============================================================================

CREATE TABLE canonical_revenue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  account_id uuid NOT NULL REFERENCES canonical_accounts(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  type text NOT NULL DEFAULT 'one_time',
  status text NOT NULL DEFAULT 'completed',
  transaction_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (account_id, external_id)
);

CREATE INDEX canonical_revenue_account_idx ON canonical_revenue (account_id);
CREATE INDEX canonical_revenue_org_idx ON canonical_revenue (organisation_id);

-- =============================================================================
-- 7. Health Snapshots — point-in-time computed health scores
-- =============================================================================

CREATE TABLE health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  account_id uuid NOT NULL REFERENCES canonical_accounts(id) ON DELETE CASCADE,
  score integer NOT NULL,
  factor_breakdown jsonb NOT NULL,
  trend text NOT NULL DEFAULT 'stable',
  confidence real NOT NULL DEFAULT 0.5,
  config_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX health_snapshots_account_time_idx ON health_snapshots (account_id, created_at DESC);
CREATE INDEX health_snapshots_org_idx ON health_snapshots (organisation_id);

-- =============================================================================
-- 8. Anomaly Events — detected metric deviations
-- =============================================================================

CREATE TABLE anomaly_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  account_id uuid NOT NULL REFERENCES canonical_accounts(id) ON DELETE CASCADE,
  metric_name text NOT NULL,
  current_value numeric,
  baseline_value numeric,
  deviation_percent real,
  direction text NOT NULL DEFAULT 'below',
  severity text NOT NULL DEFAULT 'low',
  description text,
  acknowledged boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX anomaly_events_account_time_idx ON anomaly_events (account_id, created_at DESC);
CREATE INDEX anomaly_events_org_severity_idx ON anomaly_events (organisation_id, severity, acknowledged);
