-- Migration: Autonomous Agent Teams
-- Adds: agent_templates, skills, agent_runs tables
-- Modifies: agents (sourceTemplateId), subaccount_agents (schedule/config), workspace_item_activities (agentRunId)

-- ─── 1. Agent Templates (system-level) ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS "agent_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "category" text,
  "master_prompt" text NOT NULL DEFAULT '',
  "model_provider" text NOT NULL DEFAULT 'anthropic',
  "model_id" text NOT NULL DEFAULT 'claude-sonnet-4-6',
  "temperature" real NOT NULL DEFAULT 0.7,
  "max_tokens" integer NOT NULL DEFAULT 4096,
  "default_schedule_cron" text,
  "default_token_budget" integer NOT NULL DEFAULT 30000,
  "default_max_tool_calls" integer NOT NULL DEFAULT 20,
  "expected_data_types" jsonb,
  "skill_slugs" jsonb,
  "execution_mode" text NOT NULL DEFAULT 'api',
  "is_published" boolean NOT NULL DEFAULT false,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_templates_slug_idx" ON "agent_templates" ("slug");
CREATE INDEX IF NOT EXISTS "agent_templates_category_idx" ON "agent_templates" ("category");
CREATE INDEX IF NOT EXISTS "agent_templates_published_idx" ON "agent_templates" ("is_published");

-- ─── 2. Skills table ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "skills" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organisation_id" uuid REFERENCES "organisations"("id"),
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "skill_type" text NOT NULL DEFAULT 'built_in',
  "definition" jsonb NOT NULL,
  "instructions" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp
);

CREATE INDEX IF NOT EXISTS "skills_org_idx" ON "skills" ("organisation_id");
CREATE UNIQUE INDEX IF NOT EXISTS "skills_slug_org_idx" ON "skills" ("organisation_id", "slug");
CREATE INDEX IF NOT EXISTS "skills_type_idx" ON "skills" ("skill_type");

-- ─── 3. Agent Runs table ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "agent_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organisation_id" uuid NOT NULL REFERENCES "organisations"("id"),
  "subaccount_id" uuid NOT NULL REFERENCES "subaccounts"("id"),
  "agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "subaccount_agent_id" uuid NOT NULL REFERENCES "subaccount_agents"("id"),
  "run_type" text NOT NULL,
  "execution_mode" text NOT NULL DEFAULT 'api',
  "status" text NOT NULL DEFAULT 'pending',
  "trigger_context" jsonb,
  "workspace_item_id" uuid,
  "system_prompt_snapshot" text,
  "skills_used" jsonb,
  "tool_calls_log" jsonb,
  "total_tool_calls" integer NOT NULL DEFAULT 0,
  "input_tokens" integer NOT NULL DEFAULT 0,
  "output_tokens" integer NOT NULL DEFAULT 0,
  "total_tokens" integer NOT NULL DEFAULT 0,
  "token_budget" integer NOT NULL DEFAULT 30000,
  "error_message" text,
  "error_detail" jsonb,
  "workspace_items_created" integer NOT NULL DEFAULT 0,
  "workspace_items_updated" integer NOT NULL DEFAULT 0,
  "deliverables_created" integer NOT NULL DEFAULT 0,
  "summary" text,
  "started_at" timestamp,
  "completed_at" timestamp,
  "duration_ms" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "agent_runs_org_idx" ON "agent_runs" ("organisation_id");
CREATE INDEX IF NOT EXISTS "agent_runs_subaccount_idx" ON "agent_runs" ("subaccount_id");
CREATE INDEX IF NOT EXISTS "agent_runs_agent_idx" ON "agent_runs" ("agent_id");
CREATE INDEX IF NOT EXISTS "agent_runs_status_idx" ON "agent_runs" ("status");
CREATE INDEX IF NOT EXISTS "agent_runs_org_status_idx" ON "agent_runs" ("organisation_id", "status");
CREATE INDEX IF NOT EXISTS "agent_runs_subaccount_status_idx" ON "agent_runs" ("subaccount_id", "status");
CREATE INDEX IF NOT EXISTS "agent_runs_created_at_idx" ON "agent_runs" ("created_at");
CREATE INDEX IF NOT EXISTS "agent_runs_subaccount_agent_idx" ON "agent_runs" ("subaccount_agent_id");

-- ─── 4. Modify agents table — add template reference ────────────────────────

ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "source_template_id" uuid REFERENCES "agent_templates"("id");
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "source_template_version" integer;

-- ─── 5. Modify subaccount_agents — add schedule and config columns ──────────

ALTER TABLE "subaccount_agents" ADD COLUMN IF NOT EXISTS "schedule_cron" text;
ALTER TABLE "subaccount_agents" ADD COLUMN IF NOT EXISTS "schedule_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "subaccount_agents" ADD COLUMN IF NOT EXISTS "schedule_timezone" text NOT NULL DEFAULT 'UTC';
ALTER TABLE "subaccount_agents" ADD COLUMN IF NOT EXISTS "token_budget_per_run" integer NOT NULL DEFAULT 30000;
ALTER TABLE "subaccount_agents" ADD COLUMN IF NOT EXISTS "max_tool_calls_per_run" integer NOT NULL DEFAULT 20;
ALTER TABLE "subaccount_agents" ADD COLUMN IF NOT EXISTS "timeout_seconds" integer NOT NULL DEFAULT 300;
ALTER TABLE "subaccount_agents" ADD COLUMN IF NOT EXISTS "skill_slugs" jsonb;
ALTER TABLE "subaccount_agents" ADD COLUMN IF NOT EXISTS "custom_instructions" text;
ALTER TABLE "subaccount_agents" ADD COLUMN IF NOT EXISTS "last_run_at" timestamp;
ALTER TABLE "subaccount_agents" ADD COLUMN IF NOT EXISTS "next_run_at" timestamp;

CREATE INDEX IF NOT EXISTS "subaccount_agents_schedule_idx" ON "subaccount_agents" ("schedule_enabled");

-- ─── 6. Modify workspace_item_activities — add agent run reference ──────────

ALTER TABLE "workspace_item_activities" ADD COLUMN IF NOT EXISTS "agent_run_id" uuid;
