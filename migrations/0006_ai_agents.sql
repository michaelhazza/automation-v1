CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"master_prompt" text DEFAULT '' NOT NULL,
	"model_provider" text DEFAULT 'anthropic' NOT NULL,
	"model_id" text DEFAULT 'claude-sonnet-4-6' NOT NULL,
	"temperature" real DEFAULT 0.7 NOT NULL,
	"max_tokens" integer DEFAULT 4096 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "agent_data_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"source_type" text NOT NULL,
	"source_path" text NOT NULL,
	"source_headers" jsonb,
	"content_type" text DEFAULT 'auto' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"max_token_budget" integer DEFAULT 8000 NOT NULL,
	"cache_minutes" integer DEFAULT 60 NOT NULL,
	"last_fetched_at" timestamp,
	"last_fetch_status" text,
	"last_fetch_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text,
	"tool_calls" jsonb,
	"tool_call_id" text,
	"tool_result_content" jsonb,
	"triggered_execution_id" uuid,
	"attachments" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_data_sources" ADD CONSTRAINT "agent_data_sources_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_conversation_id_agent_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "agent_conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "agents_org_slug_uniq" ON "agents" ("organisation_id","slug") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "agents_org_idx" ON "agents" ("organisation_id");
--> statement-breakpoint
CREATE INDEX "agents_org_status_idx" ON "agents" ("organisation_id","status");
--> statement-breakpoint
CREATE INDEX "agent_data_sources_agent_idx" ON "agent_data_sources" ("agent_id");
--> statement-breakpoint
CREATE INDEX "agent_data_sources_agent_priority_idx" ON "agent_data_sources" ("agent_id","priority");
--> statement-breakpoint
CREATE INDEX "agent_conversations_agent_idx" ON "agent_conversations" ("agent_id");
--> statement-breakpoint
CREATE INDEX "agent_conversations_user_idx" ON "agent_conversations" ("user_id");
--> statement-breakpoint
CREATE INDEX "agent_conversations_org_user_idx" ON "agent_conversations" ("organisation_id","user_id");
--> statement-breakpoint
CREATE INDEX "agent_conversations_agent_user_idx" ON "agent_conversations" ("agent_id","user_id");
--> statement-breakpoint
CREATE INDEX "agent_messages_conv_idx" ON "agent_messages" ("conversation_id");
--> statement-breakpoint
CREATE INDEX "agent_messages_conv_created_idx" ON "agent_messages" ("conversation_id","created_at");
