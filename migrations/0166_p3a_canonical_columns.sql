-- migrations/0166_p3a_canonical_columns.sql
-- P3A: Add owner_user_id, visibility_scope, shared_team_ids, source_connection_id
-- to all existing canonical tables.

-- canonical_accounts
ALTER TABLE canonical_accounts
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS visibility_scope text NOT NULL DEFAULT 'shared_subaccount'
    CHECK (visibility_scope IN ('private','shared_team','shared_subaccount','shared_org')),
  ADD COLUMN IF NOT EXISTS shared_team_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS source_connection_id uuid REFERENCES integration_connections(id);

CREATE INDEX IF NOT EXISTS canonical_accounts_owner_user_id_idx
  ON canonical_accounts (organisation_id, owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS canonical_accounts_shared_team_gin_idx
  ON canonical_accounts USING gin (shared_team_ids);
CREATE INDEX IF NOT EXISTS canonical_accounts_source_connection_idx
  ON canonical_accounts (source_connection_id, created_at DESC) WHERE source_connection_id IS NOT NULL;

-- canonical_contacts
ALTER TABLE canonical_contacts
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS visibility_scope text NOT NULL DEFAULT 'shared_subaccount'
    CHECK (visibility_scope IN ('private','shared_team','shared_subaccount','shared_org')),
  ADD COLUMN IF NOT EXISTS shared_team_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS source_connection_id uuid REFERENCES integration_connections(id);

CREATE INDEX IF NOT EXISTS canonical_contacts_owner_user_id_idx
  ON canonical_contacts (organisation_id, owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS canonical_contacts_shared_team_gin_idx
  ON canonical_contacts USING gin (shared_team_ids);
CREATE INDEX IF NOT EXISTS canonical_contacts_source_connection_idx
  ON canonical_contacts (source_connection_id, created_at DESC) WHERE source_connection_id IS NOT NULL;

-- canonical_opportunities
ALTER TABLE canonical_opportunities
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS visibility_scope text NOT NULL DEFAULT 'shared_subaccount'
    CHECK (visibility_scope IN ('private','shared_team','shared_subaccount','shared_org')),
  ADD COLUMN IF NOT EXISTS shared_team_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS source_connection_id uuid REFERENCES integration_connections(id);

CREATE INDEX IF NOT EXISTS canonical_opportunities_owner_user_id_idx
  ON canonical_opportunities (organisation_id, owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS canonical_opportunities_shared_team_gin_idx
  ON canonical_opportunities USING gin (shared_team_ids);
CREATE INDEX IF NOT EXISTS canonical_opportunities_source_connection_idx
  ON canonical_opportunities (source_connection_id, created_at DESC) WHERE source_connection_id IS NOT NULL;

-- canonical_conversations
ALTER TABLE canonical_conversations
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS visibility_scope text NOT NULL DEFAULT 'shared_subaccount'
    CHECK (visibility_scope IN ('private','shared_team','shared_subaccount','shared_org')),
  ADD COLUMN IF NOT EXISTS shared_team_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS source_connection_id uuid REFERENCES integration_connections(id);

CREATE INDEX IF NOT EXISTS canonical_conversations_owner_user_id_idx
  ON canonical_conversations (organisation_id, owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS canonical_conversations_shared_team_gin_idx
  ON canonical_conversations USING gin (shared_team_ids);
CREATE INDEX IF NOT EXISTS canonical_conversations_source_connection_idx
  ON canonical_conversations (source_connection_id, created_at DESC) WHERE source_connection_id IS NOT NULL;

-- canonical_revenue
ALTER TABLE canonical_revenue
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS visibility_scope text NOT NULL DEFAULT 'shared_subaccount'
    CHECK (visibility_scope IN ('private','shared_team','shared_subaccount','shared_org')),
  ADD COLUMN IF NOT EXISTS shared_team_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS source_connection_id uuid REFERENCES integration_connections(id);

CREATE INDEX IF NOT EXISTS canonical_revenue_owner_user_id_idx
  ON canonical_revenue (organisation_id, owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS canonical_revenue_shared_team_gin_idx
  ON canonical_revenue USING gin (shared_team_ids);
CREATE INDEX IF NOT EXISTS canonical_revenue_source_connection_idx
  ON canonical_revenue (source_connection_id, created_at DESC) WHERE source_connection_id IS NOT NULL;

-- canonical_metrics
ALTER TABLE canonical_metrics
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS visibility_scope text NOT NULL DEFAULT 'shared_subaccount'
    CHECK (visibility_scope IN ('private','shared_team','shared_subaccount','shared_org')),
  ADD COLUMN IF NOT EXISTS shared_team_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS source_connection_id uuid REFERENCES integration_connections(id);

CREATE INDEX IF NOT EXISTS canonical_metrics_owner_user_id_idx
  ON canonical_metrics (organisation_id, owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS canonical_metrics_shared_team_gin_idx
  ON canonical_metrics USING gin (shared_team_ids);
CREATE INDEX IF NOT EXISTS canonical_metrics_source_connection_idx
  ON canonical_metrics (source_connection_id, created_at DESC) WHERE source_connection_id IS NOT NULL;

-- canonical_metric_history
ALTER TABLE canonical_metric_history
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS visibility_scope text NOT NULL DEFAULT 'shared_subaccount'
    CHECK (visibility_scope IN ('private','shared_team','shared_subaccount','shared_org')),
  ADD COLUMN IF NOT EXISTS shared_team_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS source_connection_id uuid REFERENCES integration_connections(id);

CREATE INDEX IF NOT EXISTS canonical_metric_history_owner_user_id_idx
  ON canonical_metric_history (organisation_id, owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS canonical_metric_history_shared_team_gin_idx
  ON canonical_metric_history USING gin (shared_team_ids);
CREATE INDEX IF NOT EXISTS canonical_metric_history_source_connection_idx
  ON canonical_metric_history (source_connection_id, created_at DESC) WHERE source_connection_id IS NOT NULL;

-- health_snapshots
ALTER TABLE health_snapshots
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS visibility_scope text NOT NULL DEFAULT 'shared_subaccount'
    CHECK (visibility_scope IN ('private','shared_team','shared_subaccount','shared_org')),
  ADD COLUMN IF NOT EXISTS shared_team_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS source_connection_id uuid REFERENCES integration_connections(id);

CREATE INDEX IF NOT EXISTS health_snapshots_owner_user_id_idx
  ON health_snapshots (organisation_id, owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS health_snapshots_shared_team_gin_idx
  ON health_snapshots USING gin (shared_team_ids);
CREATE INDEX IF NOT EXISTS health_snapshots_source_connection_idx
  ON health_snapshots (source_connection_id, created_at DESC) WHERE source_connection_id IS NOT NULL;

-- anomaly_events
ALTER TABLE anomaly_events
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS visibility_scope text NOT NULL DEFAULT 'shared_subaccount'
    CHECK (visibility_scope IN ('private','shared_team','shared_subaccount','shared_org')),
  ADD COLUMN IF NOT EXISTS shared_team_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS source_connection_id uuid REFERENCES integration_connections(id);

CREATE INDEX IF NOT EXISTS anomaly_events_owner_user_id_idx
  ON anomaly_events (organisation_id, owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS anomaly_events_shared_team_gin_idx
  ON anomaly_events USING gin (shared_team_ids);
CREATE INDEX IF NOT EXISTS anomaly_events_source_connection_idx
  ON anomaly_events (source_connection_id, created_at DESC) WHERE source_connection_id IS NOT NULL;
