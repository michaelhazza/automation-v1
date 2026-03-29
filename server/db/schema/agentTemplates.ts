import { pgTable, uuid, text, boolean, integer, real, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Agent Templates — system-level library of pre-built agent definitions
// ---------------------------------------------------------------------------

export const agentTemplates = pgTable('agent_templates', {
  id: uuid('id').defaultRandom().primaryKey(),

  name: text('name').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),
  category: text('category'), // e.g. "research", "social_media", "support", "finance"

  // LLM configuration defaults
  masterPrompt: text('master_prompt').notNull().default(''),
  modelProvider: text('model_provider').notNull().default('anthropic'),
  modelId: text('model_id').notNull().default('claude-sonnet-4-6'),
  temperature: real('temperature').notNull().default(0.7),
  maxTokens: integer('max_tokens').notNull().default(4096),
  // High-level LLM presets
  responseMode: text('response_mode').notNull().default('balanced').$type<'balanced' | 'precise' | 'expressive' | 'highly_creative'>(),
  outputSize: text('output_size').notNull().default('standard').$type<'standard' | 'extended' | 'maximum'>(),
  allowModelOverride: integer('allow_model_override').notNull().default(1),

  // Scheduling defaults
  defaultScheduleCron: text('default_schedule_cron'), // e.g. "0 */2 * * *"
  defaultTokenBudget: integer('default_token_budget').notNull().default(30000),
  defaultMaxToolCalls: integer('default_max_tool_calls').notNull().default(20),

  // What this template needs
  expectedDataTypes: jsonb('expected_data_types'), // e.g. ["brand_guidelines", "competitor_list"]
  skillSlugs: jsonb('skill_slugs'), // e.g. ["web_search", "read_workspace", "write_workspace"]

  // Execution mode preference (metadata only — not enforced until headless available)
  executionMode: text('execution_mode').notNull().default('api'), // 'api' | 'headless'

  // Publishing
  isPublished: boolean('is_published').notNull().default(false),
  version: integer('version').notNull().default(1),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  slugIdx: uniqueIndex('agent_templates_slug_idx').on(table.slug),
  categoryIdx: index('agent_templates_category_idx').on(table.category),
  publishedIdx: index('agent_templates_published_idx').on(table.isPublished),
}));

export type AgentTemplate = typeof agentTemplates.$inferSelect;
export type NewAgentTemplate = typeof agentTemplates.$inferInsert;
