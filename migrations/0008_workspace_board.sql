-- Board templates (system-level presets)
CREATE TABLE "board_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"columns" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Board configs (org-level and subaccount-level column configurations)
CREATE TABLE "board_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"subaccount_id" uuid,
	"columns" jsonb NOT NULL,
	"source_template_id" uuid,
	"source_config_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Subaccount agents (agent-to-subaccount linking)
CREATE TABLE "subaccount_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"subaccount_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Workspace items (Kanban cards)
CREATE TABLE "workspace_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"subaccount_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"brief" text,
	"status" text DEFAULT 'inbox' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"assigned_agent_id" uuid,
	"created_by_agent_id" uuid,
	"task_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"due_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
-- Workspace item activities (coordination log / shared memory)
CREATE TABLE "workspace_item_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_item_id" uuid NOT NULL,
	"agent_id" uuid,
	"user_id" uuid,
	"activity_type" text NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Workspace item deliverables (outputs)
CREATE TABLE "workspace_item_deliverables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_item_id" uuid NOT NULL,
	"deliverable_type" text NOT NULL,
	"title" text NOT NULL,
	"path" text,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Add subaccount_agent_id to agent_data_sources for subaccount-level training data
ALTER TABLE "agent_data_sources" ADD COLUMN "subaccount_agent_id" uuid;
--> statement-breakpoint
-- Foreign keys: board_configs
ALTER TABLE "board_configs" ADD CONSTRAINT "board_configs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "board_configs" ADD CONSTRAINT "board_configs_subaccount_id_subaccounts_id_fk" FOREIGN KEY ("subaccount_id") REFERENCES "subaccounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "board_configs" ADD CONSTRAINT "board_configs_source_template_id_board_templates_id_fk" FOREIGN KEY ("source_template_id") REFERENCES "board_templates"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Foreign keys: subaccount_agents
ALTER TABLE "subaccount_agents" ADD CONSTRAINT "subaccount_agents_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "subaccount_agents" ADD CONSTRAINT "subaccount_agents_subaccount_id_subaccounts_id_fk" FOREIGN KEY ("subaccount_id") REFERENCES "subaccounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "subaccount_agents" ADD CONSTRAINT "subaccount_agents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Foreign keys: workspace_items
ALTER TABLE "workspace_items" ADD CONSTRAINT "workspace_items_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_items" ADD CONSTRAINT "workspace_items_subaccount_id_subaccounts_id_fk" FOREIGN KEY ("subaccount_id") REFERENCES "subaccounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_items" ADD CONSTRAINT "workspace_items_assigned_agent_id_agents_id_fk" FOREIGN KEY ("assigned_agent_id") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_items" ADD CONSTRAINT "workspace_items_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_items" ADD CONSTRAINT "workspace_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Foreign keys: workspace_item_activities
ALTER TABLE "workspace_item_activities" ADD CONSTRAINT "ws_item_activities_workspace_item_id_workspace_items_id_fk" FOREIGN KEY ("workspace_item_id") REFERENCES "workspace_items"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_item_activities" ADD CONSTRAINT "ws_item_activities_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_item_activities" ADD CONSTRAINT "ws_item_activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Foreign keys: workspace_item_deliverables
ALTER TABLE "workspace_item_deliverables" ADD CONSTRAINT "ws_item_deliverables_workspace_item_id_workspace_items_id_fk" FOREIGN KEY ("workspace_item_id") REFERENCES "workspace_items"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Foreign key: agent_data_sources -> subaccount_agents
ALTER TABLE "agent_data_sources" ADD CONSTRAINT "agent_data_sources_subaccount_agent_id_subaccount_agents_id_fk" FOREIGN KEY ("subaccount_agent_id") REFERENCES "subaccount_agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Indexes: board_configs
CREATE INDEX "board_configs_org_idx" ON "board_configs" ("organisation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "board_configs_org_subaccount_unique_idx" ON "board_configs" ("organisation_id","subaccount_id") WHERE "subaccount_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "board_configs_org_default_unique_idx" ON "board_configs" ("organisation_id") WHERE "subaccount_id" IS NULL;
--> statement-breakpoint
-- Indexes: subaccount_agents
CREATE INDEX "subaccount_agents_org_idx" ON "subaccount_agents" ("organisation_id");
--> statement-breakpoint
CREATE INDEX "subaccount_agents_subaccount_idx" ON "subaccount_agents" ("subaccount_id");
--> statement-breakpoint
CREATE INDEX "subaccount_agents_agent_idx" ON "subaccount_agents" ("agent_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "subaccount_agents_unique_idx" ON "subaccount_agents" ("subaccount_id","agent_id");
--> statement-breakpoint
-- Indexes: workspace_items
CREATE INDEX "workspace_items_org_idx" ON "workspace_items" ("organisation_id");
--> statement-breakpoint
CREATE INDEX "workspace_items_subaccount_idx" ON "workspace_items" ("subaccount_id");
--> statement-breakpoint
CREATE INDEX "workspace_items_subaccount_status_idx" ON "workspace_items" ("subaccount_id","status");
--> statement-breakpoint
CREATE INDEX "workspace_items_assigned_agent_idx" ON "workspace_items" ("assigned_agent_id");
--> statement-breakpoint
CREATE INDEX "workspace_items_status_idx" ON "workspace_items" ("status");
--> statement-breakpoint
-- Indexes: workspace_item_activities
CREATE INDEX "ws_item_activities_item_idx" ON "workspace_item_activities" ("workspace_item_id");
--> statement-breakpoint
CREATE INDEX "ws_item_activities_item_created_idx" ON "workspace_item_activities" ("workspace_item_id","created_at");
--> statement-breakpoint
CREATE INDEX "ws_item_activities_agent_idx" ON "workspace_item_activities" ("agent_id");
--> statement-breakpoint
-- Indexes: workspace_item_deliverables
CREATE INDEX "ws_item_deliverables_item_idx" ON "workspace_item_deliverables" ("workspace_item_id");
--> statement-breakpoint
-- Index: agent_data_sources subaccount_agent_id
CREATE INDEX "agent_data_sources_subaccount_agent_idx" ON "agent_data_sources" ("subaccount_agent_id");
