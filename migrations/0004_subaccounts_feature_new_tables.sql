CREATE TABLE "subaccounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"settings" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "subaccount_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subaccount_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"colour" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"group_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permission_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "permission_set_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"permission_set_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"permission_set_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subaccount_user_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subaccount_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"permission_set_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subaccount_task_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subaccount_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"subaccount_category_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subaccounts" ADD CONSTRAINT "subaccounts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "subaccount_categories" ADD CONSTRAINT "subaccount_categories_subaccount_id_subaccounts_id_fk" FOREIGN KEY ("subaccount_id") REFERENCES "subaccounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "permission_sets" ADD CONSTRAINT "permission_sets_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "permission_set_items" ADD CONSTRAINT "permission_set_items_permission_set_id_permission_sets_id_fk" FOREIGN KEY ("permission_set_id") REFERENCES "permission_sets"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "permission_set_items" ADD CONSTRAINT "permission_set_items_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "permissions"("key") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "org_user_roles" ADD CONSTRAINT "org_user_roles_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "org_user_roles" ADD CONSTRAINT "org_user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "org_user_roles" ADD CONSTRAINT "org_user_roles_permission_set_id_permission_sets_id_fk" FOREIGN KEY ("permission_set_id") REFERENCES "permission_sets"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "subaccount_user_assignments" ADD CONSTRAINT "subaccount_user_assignments_subaccount_id_subaccounts_id_fk" FOREIGN KEY ("subaccount_id") REFERENCES "subaccounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "subaccount_user_assignments" ADD CONSTRAINT "subaccount_user_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "subaccount_user_assignments" ADD CONSTRAINT "subaccount_user_assignments_permission_set_id_permission_sets_id_fk" FOREIGN KEY ("permission_set_id") REFERENCES "permission_sets"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "subaccount_task_links" ADD CONSTRAINT "subaccount_task_links_subaccount_id_subaccounts_id_fk" FOREIGN KEY ("subaccount_id") REFERENCES "subaccounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "subaccount_task_links" ADD CONSTRAINT "subaccount_task_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "subaccount_task_links" ADD CONSTRAINT "subaccount_task_links_subaccount_category_id_subaccount_categories_id_fk" FOREIGN KEY ("subaccount_category_id") REFERENCES "subaccount_categories"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "subaccounts_slug_unique_idx" ON "subaccounts" ("organisation_id","slug") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "subaccounts_org_idx" ON "subaccounts" ("organisation_id");
--> statement-breakpoint
CREATE INDEX "subaccounts_org_status_idx" ON "subaccounts" ("organisation_id","status");
--> statement-breakpoint
CREATE INDEX "subaccount_categories_subaccount_idx" ON "subaccount_categories" ("subaccount_id");
--> statement-breakpoint
CREATE INDEX "subaccount_categories_subaccount_name_idx" ON "subaccount_categories" ("subaccount_id","name");
--> statement-breakpoint
CREATE INDEX "permission_sets_org_idx" ON "permission_sets" ("organisation_id");
--> statement-breakpoint
CREATE INDEX "permission_sets_org_name_idx" ON "permission_sets" ("organisation_id","name");
--> statement-breakpoint
CREATE UNIQUE INDEX "permission_set_items_set_key_unique_idx" ON "permission_set_items" ("permission_set_id","permission_key");
--> statement-breakpoint
CREATE INDEX "permission_set_items_set_idx" ON "permission_set_items" ("permission_set_id");
--> statement-breakpoint
CREATE INDEX "permission_set_items_key_idx" ON "permission_set_items" ("permission_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "org_user_roles_org_user_unique_idx" ON "org_user_roles" ("organisation_id","user_id");
--> statement-breakpoint
CREATE INDEX "org_user_roles_org_idx" ON "org_user_roles" ("organisation_id");
--> statement-breakpoint
CREATE INDEX "org_user_roles_user_idx" ON "org_user_roles" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "subaccount_user_assignments_subaccount_user_unique_idx" ON "subaccount_user_assignments" ("subaccount_id","user_id");
--> statement-breakpoint
CREATE INDEX "subaccount_user_assignments_subaccount_idx" ON "subaccount_user_assignments" ("subaccount_id");
--> statement-breakpoint
CREATE INDEX "subaccount_user_assignments_user_idx" ON "subaccount_user_assignments" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "subaccount_task_links_subaccount_task_unique_idx" ON "subaccount_task_links" ("subaccount_id","task_id");
--> statement-breakpoint
CREATE INDEX "subaccount_task_links_subaccount_idx" ON "subaccount_task_links" ("subaccount_id");
--> statement-breakpoint
CREATE INDEX "subaccount_task_links_task_idx" ON "subaccount_task_links" ("task_id");
--> statement-breakpoint
CREATE INDEX "subaccount_task_links_category_idx" ON "subaccount_task_links" ("subaccount_category_id");
