-- Migration 0156 — Orchestrator capability-aware routing
-- See docs/orchestrator-capability-routing-spec.md for the full design.
--
-- This migration lands the shared persistence layer for the orchestrator
-- capability routing feature:
--   1. subaccount_agents.capability_map — derived JSON snapshot of what each
--      linked agent can do (§4.3 of the spec)
--   2. feature_requests — durable signal for platform capability requests
--      and system-promotion candidates (§5.2)
--   3. routing_outcomes — join table pairing decision records with their
--      downstream outcomes for the feedback loop (§9.5.2)
--
-- Each section is independent — the subaccount_agents column lands with
-- NULL default so existing rows stay valid and are reconciled by a
-- background recomputation pass after deploy.

-- ---------------------------------------------------------------------------
-- subaccount_agents.capability_map — derived snapshot
-- ---------------------------------------------------------------------------

ALTER TABLE subaccount_agents
  ADD COLUMN IF NOT EXISTS capability_map jsonb;
-- Derived JSON computed from the agent's active skill set crossed with the
-- Integration Reference. NULL = not yet computed; treated as zero-capability
-- by check_capability_gap so Path A cannot fire against uncomputed maps.
-- Shape: { computedAt, integrations[], read_capabilities[], write_capabilities[],
--          skills[], primitives[] }.

CREATE INDEX IF NOT EXISTS subaccount_agents_capability_map_computed_idx
  ON subaccount_agents ((capability_map IS NOT NULL))
  WHERE capability_map IS NOT NULL;

-- ---------------------------------------------------------------------------
-- feature_requests — durable capability-request record
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS feature_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Attribution
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid REFERENCES subaccounts(id),
  requested_by_user_id uuid NOT NULL REFERENCES users(id),
  requested_by_agent_id uuid,
  source_task_id uuid REFERENCES tasks(id),

  -- Classification
  category text NOT NULL,                           -- 'new_capability' | 'system_promotion_candidate' | 'infrastructure_alert'
  status text NOT NULL DEFAULT 'open',              -- 'open' | 'triaged' | 'accepted' | 'rejected' | 'shipped' | 'duplicate'

  -- Dedupe (§5.4)
  dedupe_hash text NOT NULL,                        -- sha256(category + '|' + sorted canonical slugs)
  dedupe_group_count integer NOT NULL DEFAULT 1,

  -- Content
  summary text NOT NULL,
  user_intent text NOT NULL,
  required_capabilities jsonb NOT NULL,
  missing_capabilities jsonb NOT NULL,
  orchestrator_reasoning text,

  -- Workflow
  notified_at timestamptz,
  notification_channels jsonb,
  triaged_by uuid REFERENCES users(id),
  triaged_at timestamptz,
  resolution_notes text,

  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS feature_requests_org_created_idx
  ON feature_requests (organisation_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS feature_requests_category_status_idx
  ON feature_requests (category, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS feature_requests_status_idx
  ON feature_requests (status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS feature_requests_org_dedupe_idx
  ON feature_requests (organisation_id, dedupe_hash)
  WHERE deleted_at IS NULL;

-- Row-level security — same pattern as tasks, see 0079_rls_tasks_actions_runs.sql.
-- Admin tooling bypasses via admin_role (BYPASSRLS) from server/lib/adminDbConnection.ts.
ALTER TABLE feature_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feature_requests_org_isolation ON feature_requests;
CREATE POLICY feature_requests_org_isolation ON feature_requests
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

-- ---------------------------------------------------------------------------
-- routing_outcomes — feedback loop signal store
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS routing_outcomes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  decision_record_id uuid NOT NULL,                 -- the uuid generated at the top of the Orchestrator routing run
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid REFERENCES subaccounts(id),
  task_id uuid REFERENCES tasks(id),

  path_taken text NOT NULL,                         -- 'A' | 'B' | 'C' | 'D' | 'legacy_fallback' | 'routing_failed' | 'routing_timeout'
  outcome text NOT NULL,                            -- 'success' | 'partial' | 'failed' | 'user_intervened' | 'abandoned'

  user_intervention_detail text,
  user_modified_after_completion boolean NOT NULL DEFAULT false,
  user_modified_fields jsonb,

  time_to_outcome_ms integer,
  downstream_errors jsonb,

  captured_at timestamptz NOT NULL DEFAULT NOW(),

  UNIQUE (decision_record_id)
);

CREATE INDEX IF NOT EXISTS routing_outcomes_org_captured_idx
  ON routing_outcomes (organisation_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS routing_outcomes_path_outcome_idx
  ON routing_outcomes (path_taken, outcome);

ALTER TABLE routing_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE routing_outcomes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS routing_outcomes_org_isolation ON routing_outcomes;
CREATE POLICY routing_outcomes_org_isolation ON routing_outcomes
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
