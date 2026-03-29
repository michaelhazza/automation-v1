-- Three-Level Process Framework migration
-- Extends processes, engines, connections, and executions for system/org/subaccount scope

-- 1. workflow_engines: add scope, subaccountId, hmacSecret; make organisationId nullable
ALTER TABLE "workflow_engines" ALTER COLUMN "organisation_id" DROP NOT NULL;
ALTER TABLE "workflow_engines" ADD COLUMN IF NOT EXISTS "scope" text NOT NULL DEFAULT 'organisation';
ALTER TABLE "workflow_engines" ADD COLUMN IF NOT EXISTS "subaccount_id" uuid REFERENCES "subaccounts"("id");
ALTER TABLE "workflow_engines" ADD COLUMN IF NOT EXISTS "hmac_secret" text;

-- Backfill hmac_secret for existing engines (generate random hex)
UPDATE "workflow_engines" SET "hmac_secret" = encode(gen_random_bytes(32), 'hex') WHERE "hmac_secret" IS NULL;
ALTER TABLE "workflow_engines" ALTER COLUMN "hmac_secret" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "workflow_engines_scope_status_idx" ON "workflow_engines" ("scope", "status");
CREATE INDEX IF NOT EXISTS "workflow_engines_subaccount_idx" ON "workflow_engines" ("subaccount_id");

-- 2. processes: add scope, configSchema, defaultConfig, requiredConnections, isEditable, parentProcessId
ALTER TABLE "processes" ALTER COLUMN "organisation_id" DROP NOT NULL;
ALTER TABLE "processes" ALTER COLUMN "workflow_engine_id" DROP NOT NULL;
ALTER TABLE "processes" ADD COLUMN IF NOT EXISTS "scope" text NOT NULL DEFAULT 'organisation';
ALTER TABLE "processes" ADD COLUMN IF NOT EXISTS "config_schema" text;
ALTER TABLE "processes" ADD COLUMN IF NOT EXISTS "default_config" jsonb;
ALTER TABLE "processes" ADD COLUMN IF NOT EXISTS "required_connections" jsonb;
ALTER TABLE "processes" ADD COLUMN IF NOT EXISTS "is_editable" boolean NOT NULL DEFAULT true;
ALTER TABLE "processes" ADD COLUMN IF NOT EXISTS "parent_process_id" uuid;

CREATE INDEX IF NOT EXISTS "processes_scope_status_idx" ON "processes" ("scope", "status");
CREATE INDEX IF NOT EXISTS "processes_parent_process_idx" ON "processes" ("parent_process_id");

-- 3. integration_connections: drop old unique, add label + token fields, new unique
ALTER TABLE "integration_connections" DROP CONSTRAINT IF EXISTS "integration_connections_subaccount_provider";
ALTER TABLE "integration_connections" ADD COLUMN IF NOT EXISTS "label" text;
ALTER TABLE "integration_connections" ADD COLUMN IF NOT EXISTS "access_token" text;
ALTER TABLE "integration_connections" ADD COLUMN IF NOT EXISTS "refresh_token" text;
ALTER TABLE "integration_connections" ADD COLUMN IF NOT EXISTS "token_expires_at" timestamp;
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_subaccount_provider_label"
  UNIQUE ("subaccount_id", "provider_type", "label");

CREATE INDEX IF NOT EXISTS "integration_connections_subaccount_idx" ON "integration_connections" ("subaccount_id");
CREATE INDEX IF NOT EXISTS "integration_connections_org_idx" ON "integration_connections" ("organisation_id");

-- 4. subaccount_process_links: add configOverrides, customInputSchema
ALTER TABLE "subaccount_process_links" ADD COLUMN IF NOT EXISTS "config_overrides" jsonb;
ALTER TABLE "subaccount_process_links" ADD COLUMN IF NOT EXISTS "custom_input_schema" text;

-- 5. executions: add new columns, make triggeredByUserId nullable
ALTER TABLE "executions" ALTER COLUMN "triggered_by_user_id" DROP NOT NULL;
ALTER TABLE "executions" ADD COLUMN IF NOT EXISTS "resolved_connections" jsonb;
ALTER TABLE "executions" ADD COLUMN IF NOT EXISTS "resolved_config" jsonb;
ALTER TABLE "executions" ADD COLUMN IF NOT EXISTS "engine_id" uuid REFERENCES "workflow_engines"("id");
ALTER TABLE "executions" ADD COLUMN IF NOT EXISTS "trigger_type" text NOT NULL DEFAULT 'manual';
ALTER TABLE "executions" ADD COLUMN IF NOT EXISTS "trigger_source_id" uuid;

CREATE INDEX IF NOT EXISTS "executions_trigger_type_idx" ON "executions" ("trigger_type");
CREATE INDEX IF NOT EXISTS "executions_engine_idx" ON "executions" ("engine_id");

-- 6. process_connection_mappings: new table
CREATE TABLE IF NOT EXISTS "process_connection_mappings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organisation_id" uuid NOT NULL REFERENCES "organisations"("id"),
  "subaccount_id" uuid NOT NULL REFERENCES "subaccounts"("id"),
  "process_id" uuid NOT NULL REFERENCES "processes"("id"),
  "connection_key" text NOT NULL,
  "connection_id" uuid NOT NULL REFERENCES "integration_connections"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "pcm_subaccount_process_key_unique" UNIQUE ("subaccount_id", "process_id", "connection_key")
);

CREATE INDEX IF NOT EXISTS "pcm_subaccount_process_idx" ON "process_connection_mappings" ("subaccount_id", "process_id");
CREATE INDEX IF NOT EXISTS "pcm_connection_idx" ON "process_connection_mappings" ("connection_id");

-- 7. Scope validation check constraints
-- Ensures scope/org/subaccount combinations are always consistent
ALTER TABLE "workflow_engines" ADD CONSTRAINT "workflow_engines_scope_check" CHECK (
  (scope = 'system' AND organisation_id IS NULL AND subaccount_id IS NULL) OR
  (scope = 'organisation' AND organisation_id IS NOT NULL AND subaccount_id IS NULL) OR
  (scope = 'subaccount' AND organisation_id IS NOT NULL AND subaccount_id IS NOT NULL)
);

ALTER TABLE "processes" ADD CONSTRAINT "processes_scope_check" CHECK (
  (scope = 'system' AND organisation_id IS NULL AND subaccount_id IS NULL) OR
  (scope = 'organisation' AND organisation_id IS NOT NULL AND subaccount_id IS NULL) OR
  (scope = 'subaccount' AND organisation_id IS NOT NULL AND subaccount_id IS NOT NULL)
);
