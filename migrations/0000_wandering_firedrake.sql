-- @rls-baseline: workflow_engines policy deferred to pre-prod-workflow-and-delegation branch (pre-prod-tenancy spec §0.4). Registry entry exists in server/config/rlsProtectedTables.ts as a registry-only deferral; the owning sister branch authors the canonical CREATE POLICY and removes this baseline entry when it lands.
CREATE TABLE "execution_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_type" text NOT NULL,
	"storage_path" text NOT NULL,
	"mime_type" text,
	"file_size_bytes" bigint,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"input_data" jsonb,
	"output_data" jsonb,
	"error_message" text,
	"error_detail" jsonb,
	"engine_type" text NOT NULL,
	"task_snapshot" jsonb,
	"is_test_execution" boolean DEFAULT false NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"plan" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"settings" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invite_token" text,
	"invite_expires_at" timestamp,
	"invited_by_user_id" uuid,
	"password_reset_token" text,
	"password_reset_expires_at" timestamp,
	"last_login_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "workflow_engines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"engine_type" text NOT NULL,
	"base_url" text NOT NULL,
	"api_key" text,
	"status" text DEFAULT 'inactive' NOT NULL,
	"last_tested_at" timestamp,
	"last_test_status" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "task_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"colour" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"workflow_engine_id" uuid NOT NULL,
	"category_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"endpoint_url" text NOT NULL,
	"http_method" text NOT NULL,
	"input_guidance" text,
	"expected_output" text,
	"timeout_seconds" integer DEFAULT 300 NOT NULL,
	"engine_type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "permission_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "permission_group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"permission_group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permission_group_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"permission_group_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "execution_files" ADD CONSTRAINT "execution_files_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_engines" ADD CONSTRAINT "workflow_engines_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_categories" ADD CONSTRAINT "task_categories_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workflow_engine_id_workflow_engines_id_fk" FOREIGN KEY ("workflow_engine_id") REFERENCES "public"."workflow_engines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_category_id_task_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."task_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_groups" ADD CONSTRAINT "permission_groups_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_group_members" ADD CONSTRAINT "permission_group_members_permission_group_id_permission_groups_id_fk" FOREIGN KEY ("permission_group_id") REFERENCES "public"."permission_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_group_members" ADD CONSTRAINT "permission_group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_group_categories" ADD CONSTRAINT "permission_group_categories_permission_group_id_permission_groups_id_fk" FOREIGN KEY ("permission_group_id") REFERENCES "public"."permission_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_group_categories" ADD CONSTRAINT "permission_group_categories_category_id_task_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."task_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "execution_files_exec_type_idx" ON "execution_files" USING btree ("execution_id","file_type");--> statement-breakpoint
CREATE INDEX "execution_files_expires_at_idx" ON "execution_files" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "execution_files_execution_idx" ON "execution_files" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "executions_org_status_idx" ON "executions" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "executions_org_task_idx" ON "executions" USING btree ("organisation_id","task_id");--> statement-breakpoint
CREATE INDEX "executions_org_user_idx" ON "executions" USING btree ("organisation_id","user_id");--> statement-breakpoint
CREATE INDEX "executions_org_created_at_idx" ON "executions" USING btree ("organisation_id","created_at");--> statement-breakpoint
CREATE INDEX "executions_user_task_created_at_idx" ON "executions" USING btree ("user_id","task_id","created_at");--> statement-breakpoint
CREATE INDEX "executions_org_id_idx" ON "executions" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "executions_task_idx" ON "executions" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "executions_user_idx" ON "executions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "executions_status_idx" ON "executions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "organisations_name_unique_idx" ON "organisations" USING btree ("name") WHERE "organisations"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "organisations_slug_unique_idx" ON "organisations" USING btree ("slug") WHERE "organisations"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "organisations_slug_idx" ON "organisations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "organisations_status_idx" ON "organisations" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique_idx" ON "users" USING btree ("organisation_id","email") WHERE "users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "users_org_role_idx" ON "users" USING btree ("organisation_id","role");--> statement-breakpoint
CREATE INDEX "users_org_id_idx" ON "users" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_invite_token_idx" ON "users" USING btree ("invite_token") WHERE "users"."invite_token" IS NOT NULL AND "users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "workflow_engines_org_status_idx" ON "workflow_engines" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "workflow_engines_org_id_idx" ON "workflow_engines" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "workflow_engines_status_idx" ON "workflow_engines" USING btree ("status");--> statement-breakpoint
CREATE INDEX "task_categories_org_name_idx" ON "task_categories" USING btree ("organisation_id","name");--> statement-breakpoint
CREATE INDEX "task_categories_org_id_idx" ON "task_categories" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "task_categories_deleted_at_idx" ON "task_categories" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "tasks_org_status_idx" ON "tasks" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "tasks_org_cat_status_idx" ON "tasks" USING btree ("organisation_id","category_id","status");--> statement-breakpoint
CREATE INDEX "tasks_engine_idx" ON "tasks" USING btree ("workflow_engine_id");--> statement-breakpoint
CREATE INDEX "tasks_org_id_idx" ON "tasks" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "tasks_category_idx" ON "tasks" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "permission_groups_org_idx" ON "permission_groups" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "permission_groups_org_name_idx" ON "permission_groups" USING btree ("organisation_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "pgm_group_user_unique_idx" ON "permission_group_members" USING btree ("permission_group_id","user_id");--> statement-breakpoint
CREATE INDEX "pgm_group_idx" ON "permission_group_members" USING btree ("permission_group_id");--> statement-breakpoint
CREATE INDEX "pgm_user_idx" ON "permission_group_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pgc_group_category_unique_idx" ON "permission_group_categories" USING btree ("permission_group_id","category_id");--> statement-breakpoint
CREATE INDEX "pgc_group_idx" ON "permission_group_categories" USING btree ("permission_group_id");--> statement-breakpoint
CREATE INDEX "pgc_category_idx" ON "permission_group_categories" USING btree ("category_id");