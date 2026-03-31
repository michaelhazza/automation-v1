-- =============================================================================
-- 0030_integrity_and_indexes.sql
-- Comprehensive integrity, index, and type-consistency improvements.
-- Covers: H-1, M-3, M-4, M-5, M-6, M-7, M-9, M-10, M-15, M-16, M-19,
--         M-20, M-21
-- =============================================================================

-- ---------------------------------------------------------------------------
-- H-1: Make budget_reservations.idempotency_key a true UNIQUE constraint
-- (was only a plain index — could not prevent duplicate inserts on concurrent
-- requests, defeating the exactly-once billing guarantee)
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "budget_reservations_idempotency_idx";
ALTER TABLE "budget_reservations"
  ADD CONSTRAINT "budget_reservations_idempotency_key_unique"
  UNIQUE ("idempotency_key");

-- ---------------------------------------------------------------------------
-- M-4 / M-16 / M-19: Missing indexes on frequently queried FK columns
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "agent_runs_task_id_idx"
  ON "agent_runs" ("task_id");

CREATE INDEX IF NOT EXISTS "agent_runs_parent_run_id_idx"
  ON "agent_runs" ("parent_run_id");

CREATE INDEX IF NOT EXISTS "agent_runs_parent_spawn_run_id_idx"
  ON "agent_runs" ("parent_spawn_run_id");

CREATE INDEX IF NOT EXISTS "actions_agent_id_idx"
  ON "actions" ("agent_id");

CREATE INDEX IF NOT EXISTS "tasks_parent_task_id_idx"
  ON "tasks" ("parent_task_id");

CREATE INDEX IF NOT EXISTS "llm_requests_execution_id_idx"
  ON "llm_requests" ("execution_id");

-- ---------------------------------------------------------------------------
-- M-3: FK constraints for self-referential / cross-table hierarchies
-- Using ON DELETE SET NULL so deletion of a parent does not cascade-delete
-- children — the system can recover orphaned rows explicitly.
-- ---------------------------------------------------------------------------
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_parent_task_id_tasks_id_fk"
  FOREIGN KEY ("parent_task_id") REFERENCES "tasks"("id") ON DELETE SET NULL;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_handoff_source_run_id_agent_runs_id_fk"
  FOREIGN KEY ("handoff_source_run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL;

ALTER TABLE "agent_runs"
  ADD CONSTRAINT "agent_runs_task_id_tasks_id_fk"
  FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL;

ALTER TABLE "agent_runs"
  ADD CONSTRAINT "agent_runs_parent_run_id_agent_runs_id_fk"
  FOREIGN KEY ("parent_run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL;

ALTER TABLE "agent_runs"
  ADD CONSTRAINT "agent_runs_parent_spawn_run_id_agent_runs_id_fk"
  FOREIGN KEY ("parent_spawn_run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL;

ALTER TABLE "actions"
  ADD CONSTRAINT "actions_parent_action_id_actions_id_fk"
  FOREIGN KEY ("parent_action_id") REFERENCES "actions"("id") ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- M-5: Unique webhook path per engine (prevents routing collisions)
-- Partial: only where an engine is assigned and the process is not deleted.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "processes_engine_webhook_unique_idx"
  ON "processes" ("workflow_engine_id", "webhook_path")
  WHERE "workflow_engine_id" IS NOT NULL AND "deleted_at" IS NULL;

-- ---------------------------------------------------------------------------
-- M-6: Unique margin config per org per effective date
-- Prevents non-deterministic billing from multiple active configs.
-- ---------------------------------------------------------------------------
ALTER TABLE "org_margin_configs"
  ADD CONSTRAINT "org_margin_configs_org_effective_unique"
  UNIQUE ("organisation_id", "effective_from");

-- ---------------------------------------------------------------------------
-- M-7: Unique category names (partial, excludes soft-deleted rows)
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "process_categories_org_name_unique_idx"
  ON "process_categories" ("organisation_id", "name")
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "subaccount_categories_name_unique_idx"
  ON "subaccount_categories" ("subaccount_id", "name")
  WHERE "deleted_at" IS NULL;

-- ---------------------------------------------------------------------------
-- M-15: Unique permission set names per organisation (partial, soft-delete-aware)
-- Replace existing plain index with unique partial index.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "permission_sets_org_name_idx";
CREATE UNIQUE INDEX "permission_sets_org_name_unique_idx"
  ON "permission_sets" ("organisation_id", "name")
  WHERE "deleted_at" IS NULL;

-- Ensure at most one default permission set per org
CREATE UNIQUE INDEX IF NOT EXISTS "permission_sets_org_default_unique_idx"
  ON "permission_sets" ("organisation_id")
  WHERE "is_default" = true AND "deleted_at" IS NULL;

-- ---------------------------------------------------------------------------
-- M-9 / M-10: Convert integer boolean flags to proper boolean columns
-- ---------------------------------------------------------------------------
-- tasks.is_sub_task
ALTER TABLE "tasks"
  ALTER COLUMN "is_sub_task" TYPE boolean
  USING ("is_sub_task" != 0);
ALTER TABLE "tasks"
  ALTER COLUMN "is_sub_task" SET DEFAULT false;

-- agent_runs.is_sub_agent
ALTER TABLE "agent_runs"
  ALTER COLUMN "is_sub_agent" TYPE boolean
  USING ("is_sub_agent" != 0);
ALTER TABLE "agent_runs"
  ALTER COLUMN "is_sub_agent" SET DEFAULT false;

-- agents.allow_model_override
ALTER TABLE "agents"
  ALTER COLUMN "allow_model_override" TYPE boolean
  USING ("allow_model_override" != 0);
ALTER TABLE "agents"
  ALTER COLUMN "allow_model_override" SET DEFAULT true;

-- agent_templates.allow_model_override (deprecated table, kept for compat)
ALTER TABLE "agent_templates"
  ALTER COLUMN "allow_model_override" TYPE boolean
  USING ("allow_model_override" != 0);
ALTER TABLE "agent_templates"
  ALTER COLUMN "allow_model_override" SET DEFAULT true;

-- ---------------------------------------------------------------------------
-- M-20: agentTriggers — rebuild eventTypeIdx as soft-delete-aware partial index
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "agent_triggers_event_type_idx";
CREATE INDEX "agent_triggers_event_type_idx"
  ON "agent_triggers" ("subaccount_id", "event_type")
  WHERE "deleted_at" IS NULL;

-- ---------------------------------------------------------------------------
-- M-21: workspaceEntities — rebuild unique index excluding soft-deleted rows
-- Allows a deleted entity name+type to be reused by a new row.
-- ---------------------------------------------------------------------------
ALTER TABLE "workspace_entities"
  DROP CONSTRAINT IF EXISTS "workspace_entities_unique";
DROP INDEX IF EXISTS "workspace_entities_unique";
CREATE UNIQUE INDEX "workspace_entities_unique"
  ON "workspace_entities" ("subaccount_id", "name", "entity_type")
  WHERE "deleted_at" IS NULL;

-- ---------------------------------------------------------------------------
-- Hierarchy templates — unique name per org (partial, soft-delete-aware)
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "hierarchy_templates_org_name_unique_idx"
  ON "hierarchy_templates" ("organisation_id", "name")
  WHERE "deleted_at" IS NULL;
