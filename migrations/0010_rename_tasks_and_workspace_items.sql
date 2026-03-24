-- Migration 0010: Rename tasks → processes and workspace_items → tasks
--
-- Current "tasks" are workflow/process definitions (trigger webhooks on engines).
-- Current "workspace_items" are kanban board cards — the natural "tasks" on a board.
--
-- Step 1: Rename tasks → processes (and related tables/columns/indexes)
-- Step 2: Rename workspace_items → tasks (and related tables/columns/indexes)
-- Order matters: we must free up the "tasks" name before reusing it.

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 1: tasks → processes
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1a. Drop existing indexes on tasks
DROP INDEX IF EXISTS "tasks_org_status_idx";
DROP INDEX IF EXISTS "tasks_org_cat_status_idx";
DROP INDEX IF EXISTS "tasks_engine_idx";
DROP INDEX IF EXISTS "tasks_org_id_idx";
DROP INDEX IF EXISTS "tasks_org_category_idx";
DROP INDEX IF EXISTS "tasks_subaccount_idx";
DROP INDEX IF EXISTS "tasks_status_idx";

-- 1b. Rename table
ALTER TABLE "tasks" RENAME TO "processes";

-- 1c. Recreate indexes with new names
CREATE INDEX "processes_org_status_idx" ON "processes" ("organisation_id", "status");
CREATE INDEX "processes_org_cat_status_idx" ON "processes" ("organisation_id", "org_category_id", "status");
CREATE INDEX "processes_engine_idx" ON "processes" ("workflow_engine_id");
CREATE INDEX "processes_org_id_idx" ON "processes" ("organisation_id");
CREATE INDEX "processes_org_category_idx" ON "processes" ("org_category_id");
CREATE INDEX "processes_subaccount_idx" ON "processes" ("subaccount_id");
CREATE INDEX "processes_status_idx" ON "processes" ("status");

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 2: task_categories → process_categories
-- ═══════════════════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS "task_categories_org_name_idx";
DROP INDEX IF EXISTS "task_categories_org_id_idx";
DROP INDEX IF EXISTS "task_categories_deleted_at_idx";

ALTER TABLE "task_categories" RENAME TO "process_categories";

CREATE INDEX "process_categories_org_name_idx" ON "process_categories" ("organisation_id", "name");
CREATE INDEX "process_categories_org_id_idx" ON "process_categories" ("organisation_id");
CREATE INDEX "process_categories_deleted_at_idx" ON "process_categories" ("deleted_at");

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 3: subaccount_task_links → subaccount_process_links
-- ═══════════════════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS "subaccount_task_links_subaccount_task_unique_idx";
DROP INDEX IF EXISTS "subaccount_task_links_subaccount_idx";
DROP INDEX IF EXISTS "subaccount_task_links_task_idx";
DROP INDEX IF EXISTS "subaccount_task_links_category_idx";

ALTER TABLE "subaccount_task_links" RENAME TO "subaccount_process_links";

-- Rename the FK column task_id → process_id
ALTER TABLE "subaccount_process_links" RENAME COLUMN "task_id" TO "process_id";

CREATE UNIQUE INDEX "subaccount_process_links_subaccount_process_unique_idx" ON "subaccount_process_links" ("subaccount_id", "process_id");
CREATE INDEX "subaccount_process_links_subaccount_idx" ON "subaccount_process_links" ("subaccount_id");
CREATE INDEX "subaccount_process_links_process_idx" ON "subaccount_process_links" ("process_id");
CREATE INDEX "subaccount_process_links_category_idx" ON "subaccount_process_links" ("subaccount_category_id");

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 4: Rename task_id → process_id in executions table
-- ═══════════════════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS "executions_org_task_idx";
DROP INDEX IF EXISTS "executions_task_idx";

ALTER TABLE "executions" RENAME COLUMN "task_id" TO "process_id";
ALTER TABLE "executions" RENAME COLUMN "task_snapshot" TO "process_snapshot";

CREATE INDEX "executions_org_process_idx" ON "executions" ("organisation_id", "process_id");
CREATE INDEX "executions_process_idx" ON "executions" ("process_id");

-- Also rename user_task index
DROP INDEX IF EXISTS "executions_user_task_created_at_idx";
CREATE INDEX "executions_user_process_created_at_idx" ON "executions" ("triggered_by_user_id", "process_id", "created_at");

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 5: workspace_items → tasks
-- ═══════════════════════════════════════════════════════════════════════════════

-- 5a. Drop existing indexes on workspace_items
DROP INDEX IF EXISTS "workspace_items_org_idx";
DROP INDEX IF EXISTS "workspace_items_subaccount_idx";
DROP INDEX IF EXISTS "workspace_items_subaccount_status_idx";
DROP INDEX IF EXISTS "workspace_items_assigned_agent_idx";
DROP INDEX IF EXISTS "workspace_items_status_idx";

-- 5b. Rename table
ALTER TABLE "workspace_items" RENAME TO "tasks";

-- 5c. Rename the task_id column (reference to process) → process_id
ALTER TABLE "tasks" RENAME COLUMN "task_id" TO "process_id";

-- 5d. Recreate indexes with new names
CREATE INDEX "tasks_org_idx" ON "tasks" ("organisation_id");
CREATE INDEX "tasks_subaccount_idx" ON "tasks" ("subaccount_id");
CREATE INDEX "tasks_subaccount_status_idx" ON "tasks" ("subaccount_id", "status");
CREATE INDEX "tasks_assigned_agent_idx" ON "tasks" ("assigned_agent_id");
CREATE INDEX "tasks_status_idx" ON "tasks" ("status");

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 6: workspace_item_activities → task_activities
-- ═══════════════════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS "ws_item_activities_item_idx";
DROP INDEX IF EXISTS "ws_item_activities_item_created_idx";
DROP INDEX IF EXISTS "ws_item_activities_agent_idx";

ALTER TABLE "workspace_item_activities" RENAME TO "task_activities";

-- Rename FK column
ALTER TABLE "task_activities" RENAME COLUMN "workspace_item_id" TO "task_id";

CREATE INDEX "task_activities_task_idx" ON "task_activities" ("task_id");
CREATE INDEX "task_activities_task_created_idx" ON "task_activities" ("task_id", "created_at");
CREATE INDEX "task_activities_agent_idx" ON "task_activities" ("agent_id");

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 7: workspace_item_deliverables → task_deliverables
-- ═══════════════════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS "ws_item_deliverables_item_idx";

ALTER TABLE "workspace_item_deliverables" RENAME TO "task_deliverables";

-- Rename FK column
ALTER TABLE "task_deliverables" RENAME COLUMN "workspace_item_id" TO "task_id";

CREATE INDEX "task_deliverables_task_idx" ON "task_deliverables" ("task_id");

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 8: Rename workspace_item_id → task_id in agent_runs
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE "agent_runs" RENAME COLUMN "workspace_item_id" TO "task_id";
ALTER TABLE "agent_runs" RENAME COLUMN "workspace_items_created" TO "tasks_created";
ALTER TABLE "agent_runs" RENAME COLUMN "workspace_items_updated" TO "tasks_updated";

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 9: Update permission keys in permission_set_items
-- ═══════════════════════════════════════════════════════════════════════════════

-- Rename org.tasks.* → org.processes.*
UPDATE "permission_set_items" SET "permission_key" = REPLACE("permission_key", 'org.tasks.', 'org.processes.') WHERE "permission_key" LIKE 'org.tasks.%';

-- Rename subaccount.tasks.* → subaccount.processes.*
UPDATE "permission_set_items" SET "permission_key" = REPLACE("permission_key", 'subaccount.tasks.', 'subaccount.processes.') WHERE "permission_key" LIKE 'subaccount.tasks.%';

-- Update permissions table
UPDATE "permissions" SET "key" = REPLACE("key", 'org.tasks.', 'org.processes.'), "group_name" = 'org.processes' WHERE "key" LIKE 'org.tasks.%';
UPDATE "permissions" SET "key" = REPLACE("key", 'subaccount.tasks.', 'subaccount.processes.'), "group_name" = 'subaccount.processes' WHERE "key" LIKE 'subaccount.tasks.%';
