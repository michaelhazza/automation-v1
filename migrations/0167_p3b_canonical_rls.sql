-- P3B: RLS on canonical tables + canonical_writer role + integration_connections
-- principal-scoped extension.
--
-- canonical_writer role: used by ingestion pipelines and sync jobs that need
-- to write canonical data without principal context. Writer bypass policies
-- are org-scoped only (no principal filtering).

-- ---------------------------------------------------------------------------
-- Create the canonical_writer role (idempotent)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'canonical_writer') THEN
    CREATE ROLE canonical_writer;
  END IF;
END $$;

-- ===========================================================================
-- Canonical tables with principal-scoped read policies
-- (tables that have owner_user_id, visibility_scope, shared_team_ids from P3A)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- canonical_accounts (has subaccount_id)
-- ---------------------------------------------------------------------------
ALTER TABLE canonical_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_accounts FORCE ROW LEVEL SECURITY;

CREATE POLICY canonical_accounts_writer_bypass ON canonical_accounts
  FOR ALL
  TO canonical_writer
  USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

CREATE POLICY canonical_accounts_principal_read ON canonical_accounts
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (
      (current_setting('app.current_principal_type', true) = 'service'
        AND visibility_scope IN ('shared_subaccount', 'shared_org')
        AND (subaccount_id IS NULL
             OR subaccount_id = current_setting('app.current_subaccount_id', true)::uuid))
      OR
      (current_setting('app.current_principal_type', true) = 'user' AND (
        (visibility_scope = 'private'
          AND owner_user_id::text = current_setting('app.current_principal_id', true))
        OR (visibility_scope = 'shared_team'
          AND shared_team_ids && (CASE
            WHEN current_setting('app.current_team_ids', true) = '' THEN '{}'::uuid[]
            ELSE string_to_array(current_setting('app.current_team_ids', true), ',')::uuid[]
          END))
        OR (visibility_scope = 'shared_subaccount'
          AND (subaccount_id IS NULL
               OR subaccount_id = current_setting('app.current_subaccount_id', true)::uuid))
        OR visibility_scope = 'shared_org'
      ))
      OR
      (current_setting('app.current_principal_type', true) = 'delegated'
        AND visibility_scope = 'private'
        AND owner_user_id::text = current_setting('app.current_principal_id', true))
    )
  );

-- ---------------------------------------------------------------------------
-- canonical_contacts (no subaccount_id)
-- ---------------------------------------------------------------------------
ALTER TABLE canonical_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_contacts FORCE ROW LEVEL SECURITY;

CREATE POLICY canonical_contacts_writer_bypass ON canonical_contacts
  FOR ALL
  TO canonical_writer
  USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

CREATE POLICY canonical_contacts_principal_read ON canonical_contacts
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (
      (current_setting('app.current_principal_type', true) = 'service'
        AND visibility_scope IN ('shared_subaccount', 'shared_org'))
      OR
      (current_setting('app.current_principal_type', true) = 'user' AND (
        (visibility_scope = 'private'
          AND owner_user_id::text = current_setting('app.current_principal_id', true))
        OR (visibility_scope = 'shared_team'
          AND shared_team_ids && (CASE
            WHEN current_setting('app.current_team_ids', true) = '' THEN '{}'::uuid[]
            ELSE string_to_array(current_setting('app.current_team_ids', true), ',')::uuid[]
          END))
        OR visibility_scope = 'shared_subaccount'
        OR visibility_scope = 'shared_org'
      ))
      OR
      (current_setting('app.current_principal_type', true) = 'delegated'
        AND visibility_scope = 'private'
        AND owner_user_id::text = current_setting('app.current_principal_id', true))
    )
  );

-- ---------------------------------------------------------------------------
-- canonical_opportunities (no subaccount_id)
-- ---------------------------------------------------------------------------
ALTER TABLE canonical_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_opportunities FORCE ROW LEVEL SECURITY;

CREATE POLICY canonical_opportunities_writer_bypass ON canonical_opportunities
  FOR ALL
  TO canonical_writer
  USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

CREATE POLICY canonical_opportunities_principal_read ON canonical_opportunities
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (
      (current_setting('app.current_principal_type', true) = 'service'
        AND visibility_scope IN ('shared_subaccount', 'shared_org'))
      OR
      (current_setting('app.current_principal_type', true) = 'user' AND (
        (visibility_scope = 'private'
          AND owner_user_id::text = current_setting('app.current_principal_id', true))
        OR (visibility_scope = 'shared_team'
          AND shared_team_ids && (CASE
            WHEN current_setting('app.current_team_ids', true) = '' THEN '{}'::uuid[]
            ELSE string_to_array(current_setting('app.current_team_ids', true), ',')::uuid[]
          END))
        OR visibility_scope = 'shared_subaccount'
        OR visibility_scope = 'shared_org'
      ))
      OR
      (current_setting('app.current_principal_type', true) = 'delegated'
        AND visibility_scope = 'private'
        AND owner_user_id::text = current_setting('app.current_principal_id', true))
    )
  );

-- ---------------------------------------------------------------------------
-- canonical_conversations (no subaccount_id)
-- ---------------------------------------------------------------------------
ALTER TABLE canonical_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_conversations FORCE ROW LEVEL SECURITY;

CREATE POLICY canonical_conversations_writer_bypass ON canonical_conversations
  FOR ALL
  TO canonical_writer
  USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

CREATE POLICY canonical_conversations_principal_read ON canonical_conversations
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (
      (current_setting('app.current_principal_type', true) = 'service'
        AND visibility_scope IN ('shared_subaccount', 'shared_org'))
      OR
      (current_setting('app.current_principal_type', true) = 'user' AND (
        (visibility_scope = 'private'
          AND owner_user_id::text = current_setting('app.current_principal_id', true))
        OR (visibility_scope = 'shared_team'
          AND shared_team_ids && (CASE
            WHEN current_setting('app.current_team_ids', true) = '' THEN '{}'::uuid[]
            ELSE string_to_array(current_setting('app.current_team_ids', true), ',')::uuid[]
          END))
        OR visibility_scope = 'shared_subaccount'
        OR visibility_scope = 'shared_org'
      ))
      OR
      (current_setting('app.current_principal_type', true) = 'delegated'
        AND visibility_scope = 'private'
        AND owner_user_id::text = current_setting('app.current_principal_id', true))
    )
  );

-- ===========================================================================
-- Canonical tables with org-scoped read policies only
-- (these have P3A visibility columns but use org-scoped reads for now)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- canonical_revenue
-- ---------------------------------------------------------------------------
ALTER TABLE canonical_revenue ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_revenue FORCE ROW LEVEL SECURITY;

CREATE POLICY canonical_revenue_writer_bypass ON canonical_revenue
  FOR ALL
  TO canonical_writer
  USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

CREATE POLICY canonical_revenue_org_read ON canonical_revenue
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ---------------------------------------------------------------------------
-- health_snapshots
-- ---------------------------------------------------------------------------
ALTER TABLE health_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_snapshots FORCE ROW LEVEL SECURITY;

CREATE POLICY health_snapshots_writer_bypass ON health_snapshots
  FOR ALL
  TO canonical_writer
  USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

CREATE POLICY health_snapshots_org_read ON health_snapshots
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ---------------------------------------------------------------------------
-- anomaly_events
-- ---------------------------------------------------------------------------
ALTER TABLE anomaly_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE anomaly_events FORCE ROW LEVEL SECURITY;

CREATE POLICY anomaly_events_writer_bypass ON anomaly_events
  FOR ALL
  TO canonical_writer
  USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

CREATE POLICY anomaly_events_org_read ON anomaly_events
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ---------------------------------------------------------------------------
-- canonical_metrics
-- ---------------------------------------------------------------------------
ALTER TABLE canonical_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_metrics FORCE ROW LEVEL SECURITY;

CREATE POLICY canonical_metrics_writer_bypass ON canonical_metrics
  FOR ALL
  TO canonical_writer
  USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

CREATE POLICY canonical_metrics_org_read ON canonical_metrics
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ---------------------------------------------------------------------------
-- canonical_metric_history
-- ---------------------------------------------------------------------------
ALTER TABLE canonical_metric_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_metric_history FORCE ROW LEVEL SECURITY;

CREATE POLICY canonical_metric_history_writer_bypass ON canonical_metric_history
  FOR ALL
  TO canonical_writer
  USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

CREATE POLICY canonical_metric_history_org_read ON canonical_metric_history
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ===========================================================================
-- integration_connections: replace org-only isolation with principal-aware policy
-- ===========================================================================
DROP POLICY IF EXISTS integration_connections_org_isolation ON integration_connections;

ALTER TABLE integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_connections FORCE ROW LEVEL SECURITY;

CREATE POLICY integration_connections_principal_read ON integration_connections
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (
      (ownership_scope IN ('subaccount', 'organisation')
        AND visibility_scope IN ('shared_subaccount', 'shared_org'))
      OR
      (ownership_scope = 'user'
        AND owner_user_id::text = current_setting('app.current_principal_id', true))
      OR
      (ownership_scope = 'user'
        AND visibility_scope = 'shared_team'
        AND shared_team_ids && (CASE
          WHEN current_setting('app.current_team_ids', true) = '' THEN '{}'::uuid[]
          ELSE string_to_array(current_setting('app.current_team_ids', true), ',')::uuid[]
        END))
      OR
      (current_setting('app.current_principal_type', true) = 'delegated'
        AND ownership_scope = 'user'
        AND owner_user_id::text = current_setting('app.current_principal_id', true))
    )
  );
