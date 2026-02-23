-- Drop junction tables first (they reference permission_groups)
DROP TABLE IF EXISTS "permission_group_categories";
--> statement-breakpoint
DROP TABLE IF EXISTS "permission_group_members";
--> statement-breakpoint
DROP TABLE IF EXISTS "permission_groups";
--> statement-breakpoint

-- ─── tasks ────────────────────────────────────────────────────────────────────
-- Rename columns
ALTER TABLE "tasks" RENAME COLUMN "input_guidance" TO "input_schema";
--> statement-breakpoint
ALTER TABLE "tasks" RENAME COLUMN "expected_output" TO "output_schema";
--> statement-breakpoint
ALTER TABLE "tasks" RENAME COLUMN "category_id" TO "org_category_id";
--> statement-breakpoint

-- Add new columns (nullable first so existing rows are valid)
ALTER TABLE "tasks" ADD COLUMN "webhook_path" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "subaccount_id" uuid;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "subaccount_category_id" uuid;
--> statement-breakpoint

-- Backfill webhook_path from endpoint_url before making it NOT NULL
UPDATE "tasks" SET "webhook_path" = "endpoint_url" WHERE "webhook_path" IS NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "webhook_path" SET NOT NULL;
--> statement-breakpoint

-- Drop old columns
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "endpoint_url";
--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "http_method";
--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "timeout_seconds";
--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "engine_type";
--> statement-breakpoint

-- Add FKs for new columns
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_subaccount_id_subaccounts_id_fk"
  FOREIGN KEY ("subaccount_id") REFERENCES "subaccounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_subaccount_category_id_subaccount_categories_id_fk"
  FOREIGN KEY ("subaccount_category_id") REFERENCES "subaccount_categories"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- Drop old indexes that referenced category_id (now org_category_id)
DROP INDEX IF EXISTS "tasks_category_idx";
--> statement-breakpoint

-- Add new index for subaccount_id and renamed org_category_id
CREATE INDEX "tasks_org_category_idx" ON "tasks" ("org_category_id");
--> statement-breakpoint
CREATE INDEX "tasks_subaccount_idx" ON "tasks" ("subaccount_id");
--> statement-breakpoint

-- ─── executions ───────────────────────────────────────────────────────────────
-- Rename user_id to triggered_by_user_id
ALTER TABLE "executions" RENAME COLUMN "user_id" TO "triggered_by_user_id";
--> statement-breakpoint

-- Add subaccount_id column
ALTER TABLE "executions" ADD COLUMN "subaccount_id" uuid;
--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_subaccount_id_subaccounts_id_fk"
  FOREIGN KEY ("subaccount_id") REFERENCES "subaccounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "executions_subaccount_idx" ON "executions" ("subaccount_id");
--> statement-breakpoint

-- ─── users ────────────────────────────────────────────────────────────────────
-- Make role nullable (only system_admin users will have this set)
ALTER TABLE "users" ALTER COLUMN "role" DROP NOT NULL;
--> statement-breakpoint
-- Clear non-system-admin role values (all access now via permission sets)
UPDATE "users" SET "role" = NULL WHERE "role" != 'system_admin';
