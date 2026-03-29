-- Phase 2: Scheduled Workforce
-- Adds scheduled tasks, sub-agent tracking, team roster support

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Scheduled Tasks
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "scheduled_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organisation_id" uuid NOT NULL REFERENCES "organisations"("id"),
  "subaccount_id" uuid NOT NULL REFERENCES "subaccounts"("id"),
  "title" text NOT NULL,
  "description" text,
  "brief" text,
  "priority" text NOT NULL DEFAULT 'normal',
  "assigned_agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "created_by_user_id" uuid REFERENCES "users"("id"),
  "rrule" text NOT NULL,
  "timezone" text NOT NULL DEFAULT 'UTC',
  "schedule_time" text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "retry_policy" jsonb,
  "token_budget_per_run" integer NOT NULL DEFAULT 30000,
  "next_run_at" timestamp,
  "last_run_at" timestamp,
  "total_runs" integer NOT NULL DEFAULT 0,
  "total_failures" integer NOT NULL DEFAULT 0,
  "consecutive_failures" integer NOT NULL DEFAULT 0,
  "ends_at" timestamp,
  "ends_after_runs" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "scheduled_tasks_org_idx"
  ON "scheduled_tasks" ("organisation_id");
CREATE INDEX IF NOT EXISTS "scheduled_tasks_subaccount_active_idx"
  ON "scheduled_tasks" ("subaccount_id", "is_active");
CREATE INDEX IF NOT EXISTS "scheduled_tasks_next_run_idx"
  ON "scheduled_tasks" ("next_run_at", "is_active");

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Scheduled Task Runs
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "scheduled_task_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scheduled_task_id" uuid NOT NULL REFERENCES "scheduled_tasks"("id") ON DELETE CASCADE,
  "task_id" uuid,
  "agent_run_id" uuid,
  "occurrence" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "attempt" integer NOT NULL DEFAULT 1,
  "error_message" text,
  "scheduled_for" timestamp NOT NULL,
  "started_at" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "scheduled_task_runs_st_idx"
  ON "scheduled_task_runs" ("scheduled_task_id");
CREATE INDEX IF NOT EXISTS "scheduled_task_runs_status_idx"
  ON "scheduled_task_runs" ("status");
CREATE INDEX IF NOT EXISTS "scheduled_task_runs_scheduled_for_idx"
  ON "scheduled_task_runs" ("scheduled_for");

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Agent Runs — sub-agent tracking
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "agent_runs"
  ADD COLUMN IF NOT EXISTS "is_sub_agent" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "parent_spawn_run_id" uuid;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Tasks — sub-task tracking
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "is_sub_task" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "parent_task_id" uuid;
