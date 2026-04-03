import { pgTable, uuid, text, boolean, integer, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations.js';
import { agents } from './agents.js';

export const orgAgentConfigs = pgTable(
  'org_agent_configs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    agentId: uuid('agent_id').notNull().references(() => agents.id),
    isActive: boolean('is_active').notNull().default(true),

    // Execution limits
    tokenBudgetPerRun: integer('token_budget_per_run').notNull().default(30000),
    maxToolCallsPerRun: integer('max_tool_calls_per_run').notNull().default(20),
    timeoutSeconds: integer('timeout_seconds').notNull().default(300),
    maxCostPerRunCents: integer('max_cost_per_run_cents'),
    maxLlmCallsPerRun: integer('max_llm_calls_per_run'),

    // Skill configuration
    skillSlugs: jsonb('skill_slugs').$type<string[]>(),
    allowedSkillSlugs: jsonb('allowed_skill_slugs').$type<string[]>(),
    customInstructions: text('custom_instructions'),

    // Heartbeat scheduling
    heartbeatEnabled: boolean('heartbeat_enabled').notNull().default(false),
    heartbeatIntervalHours: integer('heartbeat_interval_hours').notNull().default(24),
    heartbeatOffsetMinutes: integer('heartbeat_offset_minutes').notNull().default(0),

    // Cron scheduling
    scheduleCron: text('schedule_cron'),
    scheduleEnabled: boolean('schedule_enabled').notNull().default(false),
    scheduleTimezone: text('schedule_timezone').notNull().default('UTC'),

    // Runtime state
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),

    // Cross-boundary access control
    allowedSubaccountIds: jsonb('allowed_subaccount_ids').$type<string[]>(),

    // Template tracking
    appliedTemplateId: uuid('applied_template_id'),
    appliedTemplateVersion: integer('applied_template_version'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgAgentUnique: uniqueIndex('org_agent_configs_org_agent_unique').on(table.organisationId, table.agentId),
    orgIdx: index('org_agent_configs_org_idx').on(table.organisationId),
    agentIdx: index('org_agent_configs_agent_idx').on(table.agentId),
    activeIdx: index('org_agent_configs_active_idx')
      .on(table.organisationId, table.isActive)
      .where(sql`${table.isActive} = true`),
    scheduleIdx: index('org_agent_configs_schedule_idx')
      .on(table.scheduleEnabled)
      .where(sql`${table.scheduleEnabled} = true`),
  })
);

export type OrgAgentConfig = typeof orgAgentConfigs.$inferSelect;
export type NewOrgAgentConfig = typeof orgAgentConfigs.$inferInsert;
