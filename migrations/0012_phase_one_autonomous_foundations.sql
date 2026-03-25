-- Phase I: Autonomous Foundations
-- Adds workspace memories, memory entries, handoff support, middleware columns

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Workspace Memories — compiled shared memory per workspace (subaccount)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "workspace_memories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organisation_id" uuid NOT NULL REFERENCES "organisations"("id"),
  "subaccount_id" uuid NOT NULL REFERENCES "subaccounts"("id"),
  "summary" text,
  "board_summary" text,
  "runs_since_summary" integer NOT NULL DEFAULT 0,
  "summary_threshold" integer NOT NULL DEFAULT 5,
  "version" integer NOT NULL DEFAULT 0,
  "summary_generated_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "workspace_memories_org_idx"
  ON "workspace_memories" ("organisation_id");

CREATE UNIQUE INDEX IF NOT EXISTS "workspace_memories_subaccount_unique"
  ON "workspace_memories" ("organisation_id", "subaccount_id");

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Workspace Memory Entries — individual insights from agent runs
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "workspace_memory_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organisation_id" uuid NOT NULL REFERENCES "organisations"("id"),
  "subaccount_id" uuid NOT NULL REFERENCES "subaccounts"("id"),
  "agent_run_id" uuid NOT NULL REFERENCES "agent_runs"("id"),
  "agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "content" text NOT NULL,
  "entry_type" text NOT NULL,
  "included_in_summary" boolean NOT NULL DEFAULT false,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "workspace_memory_entries_subaccount_idx"
  ON "workspace_memory_entries" ("subaccount_id", "included_in_summary");

CREATE INDEX IF NOT EXISTS "workspace_memory_entries_run_idx"
  ON "workspace_memory_entries" ("agent_run_id");

CREATE INDEX IF NOT EXISTS "workspace_memory_entries_created_idx"
  ON "workspace_memory_entries" ("created_at");

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Tasks — handoff tracking columns
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "handoff_source_run_id" uuid,
  ADD COLUMN IF NOT EXISTS "handoff_context" jsonb,
  ADD COLUMN IF NOT EXISTS "handoff_depth" integer NOT NULL DEFAULT 0;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Agent Runs — handoff + context tracking columns
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "agent_runs"
  ADD COLUMN IF NOT EXISTS "system_prompt_tokens" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "handoff_depth" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "parent_run_id" uuid;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Subaccount Agents — tool restriction column
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "subaccount_agents"
  ADD COLUMN IF NOT EXISTS "allowed_skill_slugs" jsonb;
