import { pgTable, uuid, text, boolean, integer, real, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// System Agents — platform-level agent definitions (our IP)
// These are the authoritative system-level agents that orgs inherit from.
// Org admins cannot see the masterPrompt or system skills.
// ---------------------------------------------------------------------------

export const systemAgents = pgTable('system_agents', {
  id: uuid('id').defaultRandom().primaryKey(),

  name: text('name').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),
  icon: text('icon'),

  // ── Hierarchy ──────────────────────────────────────────────────────────
  parentSystemAgentId: uuid('parent_system_agent_id'),
  agentRole: text('agent_role'),
  agentTitle: text('agent_title'),

  // System-level master prompt (our IP — never exposed to org admins)
  masterPrompt: text('master_prompt').notNull().default(''),

  // LLM configuration defaults
  modelProvider: text('model_provider').notNull().default('anthropic'),
  modelId: text('model_id').notNull().default('claude-sonnet-4-6'),
  temperature: real('temperature').notNull().default(0.7),
  maxTokens: integer('max_tokens').notNull().default(4096),

  // System skills always attached to this agent (hidden from org UI)
  defaultSystemSkillSlugs: jsonb('default_system_skill_slugs').$type<string[]>().default([]),
  // Org-visible skills suggested by default when org installs this agent
  defaultOrgSkillSlugs: jsonb('default_org_skill_slugs').$type<string[]>().default([]),

  // Whether org admins can override model config
  allowModelOverride: boolean('allow_model_override').notNull().default(true),

  // Scheduling defaults
  defaultScheduleCron: text('default_schedule_cron'),
  defaultTokenBudget: integer('default_token_budget').notNull().default(30000),
  defaultMaxToolCalls: integer('default_max_tool_calls').notNull().default(20),

  // Heartbeat defaults (blueprint — copied to org agents on install)
  heartbeatEnabled: boolean('heartbeat_enabled').notNull().default(false),
  heartbeatIntervalHours: integer('heartbeat_interval_hours'),
  heartbeatOffsetHours: integer('heartbeat_offset_hours').notNull().default(0),

  // Execution mode preference
  executionMode: text('execution_mode').notNull().default('api').$type<'api' | 'headless'>(),

  // Publishing & lifecycle
  isPublished: boolean('is_published').notNull().default(false),
  version: integer('version').notNull().default(1),
  status: text('status').notNull().default('draft').$type<'draft' | 'active' | 'inactive'>(),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  slugIdx: uniqueIndex('system_agents_slug_idx').on(table.slug),
  statusIdx: index('system_agents_status_idx').on(table.status),
  publishedIdx: index('system_agents_published_idx').on(table.isPublished),
}));

export type SystemAgent = typeof systemAgents.$inferSelect;
export type NewSystemAgent = typeof systemAgents.$inferInsert;
