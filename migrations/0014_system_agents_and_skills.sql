-- System Agents & Skills — Multi-level inheritance hierarchy
-- Adds system-level agents and skills that org agents inherit from.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. System Skills — platform-level capabilities (our IP, hidden from orgs)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "system_skills" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "definition" jsonb NOT NULL,
  "instructions" text,
  "methodology" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "system_skills_slug_idx" ON "system_skills" ("slug");
CREATE INDEX IF NOT EXISTS "system_skills_active_idx" ON "system_skills" ("is_active");

-- ────────────────────────────────────────────────────────────────────────────
-- 2. System Agents — platform-level agent definitions (our IP)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "system_agents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "icon" text,
  "master_prompt" text NOT NULL DEFAULT '',
  "model_provider" text NOT NULL DEFAULT 'anthropic',
  "model_id" text NOT NULL DEFAULT 'claude-sonnet-4-6',
  "temperature" real NOT NULL DEFAULT 0.7,
  "max_tokens" integer NOT NULL DEFAULT 4096,
  "default_system_skill_slugs" jsonb DEFAULT '[]',
  "default_org_skill_slugs" jsonb DEFAULT '[]',
  "allow_model_override" boolean NOT NULL DEFAULT true,
  "default_schedule_cron" text,
  "default_token_budget" integer NOT NULL DEFAULT 30000,
  "default_max_tool_calls" integer NOT NULL DEFAULT 20,
  "execution_mode" text NOT NULL DEFAULT 'api',
  "is_published" boolean NOT NULL DEFAULT false,
  "version" integer NOT NULL DEFAULT 1,
  "status" text NOT NULL DEFAULT 'draft',
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS "system_agents_slug_idx" ON "system_agents" ("slug");
CREATE INDEX IF NOT EXISTS "system_agents_status_idx" ON "system_agents" ("status");
CREATE INDEX IF NOT EXISTS "system_agents_published_idx" ON "system_agents" ("is_published");

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Add inheritance columns to agents table
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "system_agent_id" uuid REFERENCES "system_agents"("id");
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "is_system_managed" boolean NOT NULL DEFAULT false;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "additional_prompt" text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS "agents_system_agent_idx" ON "agents" ("system_agent_id");
