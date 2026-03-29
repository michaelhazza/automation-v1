-- HITL Action System: Phase 1A Platform Foundations
-- Creates the action/approval/review layer for human-in-the-loop execution gating

-- ---------------------------------------------------------------------------
-- Actions — proposed or executable units of work with gate enforcement
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organisation_id" uuid NOT NULL REFERENCES "organisations"("id"),
  "subaccount_id" uuid NOT NULL REFERENCES "subaccounts"("id"),
  "agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "agent_run_id" uuid REFERENCES "agent_runs"("id"),
  "parent_action_id" uuid,

  "action_type" text NOT NULL,
  "action_category" text NOT NULL,
  "is_external" boolean NOT NULL DEFAULT false,
  "gate_level" text NOT NULL,

  "status" text NOT NULL DEFAULT 'proposed',
  "payload_version" integer NOT NULL DEFAULT 1,
  "idempotency_key" text NOT NULL,
  "payload_json" jsonb NOT NULL,
  "metadata_json" jsonb,

  "result_json" jsonb,
  "result_status" text,
  "error_json" jsonb,

  "approved_by" uuid REFERENCES "users"("id"),
  "approved_at" timestamp,
  "executed_at" timestamp,
  "retry_count" integer NOT NULL DEFAULT 0,
  "max_retries" integer NOT NULL DEFAULT 3,

  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "actions_org_idx" ON "actions" ("organisation_id");
CREATE INDEX IF NOT EXISTS "actions_subaccount_status_idx" ON "actions" ("subaccount_id", "status");
CREATE INDEX IF NOT EXISTS "actions_agent_run_idx" ON "actions" ("agent_run_id");
CREATE INDEX IF NOT EXISTS "actions_parent_action_idx" ON "actions" ("parent_action_id");
CREATE UNIQUE INDEX IF NOT EXISTS "actions_idempotency_idx" ON "actions" ("subaccount_id", "idempotency_key");

-- ---------------------------------------------------------------------------
-- Action Events — immutable audit trail
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "action_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organisation_id" uuid NOT NULL REFERENCES "organisations"("id"),
  "action_id" uuid NOT NULL REFERENCES "actions"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
  "actor_id" uuid REFERENCES "users"("id"),
  "metadata_json" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "action_events_action_idx" ON "action_events" ("action_id");
CREATE INDEX IF NOT EXISTS "action_events_org_created_idx" ON "action_events" ("organisation_id", "created_at");

-- ---------------------------------------------------------------------------
-- Review Items — human-facing projection of actions needing approval
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "review_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organisation_id" uuid NOT NULL REFERENCES "organisations"("id"),
  "subaccount_id" uuid NOT NULL REFERENCES "subaccounts"("id"),
  "action_id" uuid NOT NULL REFERENCES "actions"("id") ON DELETE CASCADE,
  "agent_run_id" uuid REFERENCES "agent_runs"("id"),

  "review_status" text NOT NULL DEFAULT 'pending',
  "review_payload_json" jsonb NOT NULL,
  "human_edit_json" jsonb,

  "reviewed_by" uuid REFERENCES "users"("id"),
  "reviewed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "review_items_action_unique" ON "review_items" ("action_id");
CREATE INDEX IF NOT EXISTS "review_items_subaccount_status_idx" ON "review_items" ("subaccount_id", "review_status");
CREATE INDEX IF NOT EXISTS "review_items_agent_run_idx" ON "review_items" ("agent_run_id");

-- ---------------------------------------------------------------------------
-- Integration Connections — stored external service credentials
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "integration_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organisation_id" uuid NOT NULL REFERENCES "organisations"("id"),
  "subaccount_id" uuid NOT NULL REFERENCES "subaccounts"("id"),
  "provider_type" text NOT NULL,
  "auth_type" text NOT NULL,
  "connection_status" text NOT NULL DEFAULT 'active',
  "display_name" text,
  "config_json" jsonb,
  "secrets_ref" text,
  "last_verified_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "integration_connections_subaccount_provider" ON "integration_connections" ("subaccount_id", "provider_type");

-- ---------------------------------------------------------------------------
-- Processed Resources — deduplication log for external inputs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "processed_resources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organisation_id" uuid NOT NULL REFERENCES "organisations"("id"),
  "subaccount_id" uuid NOT NULL REFERENCES "subaccounts"("id"),
  "integration_type" text NOT NULL,
  "resource_type" text NOT NULL,
  "external_id" text NOT NULL,
  "agent_id" uuid REFERENCES "agents"("id"),
  "first_seen_at" timestamp NOT NULL DEFAULT now(),
  "processed_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "processed_resources_dedup" ON "processed_resources" ("subaccount_id", "integration_type", "resource_type", "external_id");
CREATE INDEX IF NOT EXISTS "processed_resources_subaccount_type_idx" ON "processed_resources" ("subaccount_id", "integration_type", "resource_type");

-- ---------------------------------------------------------------------------
-- Workspace Limits — daily token/cost caps per subaccount
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "workspace_limits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "subaccount_id" uuid NOT NULL REFERENCES "subaccounts"("id"),
  "daily_token_limit" integer,
  "daily_cost_limit_cents" integer,
  "per_run_token_limit" integer,
  "alert_threshold_pct" integer NOT NULL DEFAULT 80,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "workspace_limits_subaccount_unique" ON "workspace_limits" ("subaccount_id");
